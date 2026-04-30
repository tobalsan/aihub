import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expandPath } from "@aihub/shared";
import { splitFrontmatter } from "./frontmatter.js";

const execFileAsync = promisify(execFile);

export type BoardProjectGroup = "active" | "review" | "stale" | "done";

export type BoardWorktree = {
  name: string;
  path: string;
  branch: string;
  dirty: boolean;
  ahead: number;
};

export type BoardAgentRunView = {
  runId: string;
  label: string;
  cli: string;
  status: "running" | "done" | "failed" | "interrupted" | string;
  startedAt: string;
  updatedAt: string;
};

export type BoardWorktreeView = Omit<BoardWorktree, "branch"> & {
  id: string;
  workerSlug: string;
  worktreePath: string;
  branch: string | null;
  queueStatus:
    | "pending"
    | "integrated"
    | "conflict"
    | "skipped"
    | "stale_worker"
    | null;
  agentRun: BoardAgentRunView | null;
  startedAt?: string;
  integratedAt?: string;
  startSha?: string;
  endSha?: string;
};

export type BoardProject = {
  id: string;
  title: string;
  area: string;
  status: string;
  group: BoardProjectGroup;
  created: string;
  worktrees: BoardWorktreeView[];
};

const PROJECT_DIR_PATTERN = /^PRO-/;
const SKIP_DIRS = new Set([".workspaces", ".archive", ".done", ".trash"]);

const GROUP_ORDER: Record<BoardProjectGroup, number> = {
  review: 0,
  active: 1,
  stale: 2,
  done: 3,
};

const DEFAULT_PROJECT_CACHE_TTL_MS = 10_000;
const DEFAULT_REPO_WORKTREE_TTL_MS = 30_000;
const DEFAULT_BRANCH_CACHE_TTL_MS = 30_000;
const DEFAULT_DIRTY_AHEAD_TTL_MS = 15_000;

export type ScanProjectsOptions = {
  cacheTtlMs?: number;
  repoWorktreeTtlMs?: number;
  branchTtlMs?: number;
  dirtyAheadTtlMs?: number;
  getSpace?: (projectId: string) => Promise<SpaceView | null>;
  runsByCwd?: Map<string, AgentRunSummaryView>;
};

type SpaceQueueEntryView = {
  id: string;
  workerSlug: string;
  worktreePath: string;
  status: BoardWorktreeView["queueStatus"];
  createdAt: string;
  integratedAt?: string;
  startSha?: string;
  endSha?: string;
};

type SpaceView = {
  worktreePath: string;
  queue: SpaceQueueEntryView[];
};

type AgentRunSummaryView = {
  runId: string;
  label: string;
  cli: string;
  cwd?: string;
  status: string;
  startedAt: string;
  updatedAt: string;
};

type ProjectCacheEntry = {
  value: BoardProject[];
  expiresAt: number;
};

type RepoWorktreeCacheEntry = {
  value: Array<{ path: string; name: string }>;
  expiresAt: number;
};

type BranchCacheEntry = {
  branch: string | null;
  headPath: string;
  mtimeMs: number;
  expiresAt: number;
};

type DirtyAheadCacheEntry = {
  dirty: boolean;
  ahead: number;
  expiresAt: number;
};

type GitMetadata = {
  gitDir: string;
  commonGitDir: string;
  headPath: string;
  indexPath: string;
};

const projectResultCache = new Map<string, ProjectCacheEntry>();
const inFlightScans = new Map<string, Promise<BoardProject[]>>();

// These process-local caches keep the hot board endpoint free of filesystem
// and git work on repeat requests while still allowing event-driven invalidation.
const repoWorktreeCache = new Map<string, RepoWorktreeCacheEntry>();
const branchCache = new Map<string, BranchCacheEntry>();
const dirtyAheadCache = new Map<string, DirtyAheadCacheEntry>();
const indexWatchers = new Map<
  string,
  { watcher?: FSWatcher; worktreeKey: string; mtimeMs: number }
>();
let projectCacheVersion = 0;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function projectCacheTtlMs(options?: ScanProjectsOptions): number {
  return (
    options?.cacheTtlMs ??
    readPositiveIntEnv(
      "AIHUB_BOARD_PROJECTS_CACHE_TTL_MS",
      DEFAULT_PROJECT_CACHE_TTL_MS
    )
  );
}

function repoWorktreeTtlMs(options?: ScanProjectsOptions): number {
  return (
    options?.repoWorktreeTtlMs ??
    readPositiveIntEnv(
      "AIHUB_BOARD_REPO_WORKTREE_TTL_MS",
      DEFAULT_REPO_WORKTREE_TTL_MS
    )
  );
}

function branchTtlMs(options?: ScanProjectsOptions): number {
  return (
    options?.branchTtlMs ??
    readPositiveIntEnv(
      "AIHUB_BOARD_BRANCH_CACHE_TTL_MS",
      DEFAULT_BRANCH_CACHE_TTL_MS
    )
  );
}

function dirtyAheadTtlMs(options?: ScanProjectsOptions): number {
  return (
    options?.dirtyAheadTtlMs ??
    readPositiveIntEnv(
      "AIHUB_BOARD_DIRTY_AHEAD_TTL_MS",
      DEFAULT_DIRTY_AHEAD_TTL_MS
    )
  );
}

function scanCacheKey(
  projectsRoot: string,
  worktreesRoot: string,
  includeDone: boolean,
  options?: ScanProjectsOptions
): string {
  const variant = options?.getSpace || options?.runsByCwd ? "joined" : "base";
  return `${projectsRoot}\0${worktreesRoot}\0${includeDone ? "1" : "0"}\0${variant}`;
}

export function invalidateProjectCache(projectsRoot?: string): void {
  projectCacheVersion++;
  if (!projectsRoot) {
    projectResultCache.clear();
    inFlightScans.clear();
    return;
  }
  const prefix = `${projectsRoot}\0`;
  for (const key of projectResultCache.keys()) {
    if (key.startsWith(prefix)) projectResultCache.delete(key);
  }
  for (const key of inFlightScans.keys()) {
    if (key.startsWith(prefix)) inFlightScans.delete(key);
  }
}

export function resetProjectCaches(): void {
  projectCacheVersion++;
  projectResultCache.clear();
  inFlightScans.clear();
  repoWorktreeCache.clear();
  branchCache.clear();
  dirtyAheadCache.clear();
  for (const { watcher } of indexWatchers.values()) watcher?.close();
  indexWatchers.clear();
}

export function statusToGroup(status: string): BoardProjectGroup {
  switch (status) {
    case "current":
    case "todo":
    case "shaping":
    case "in_progress":
      return "active";
    case "review":
      return "review";
    case "not_now":
    case "maybe":
      return "stale";
    case "done":
    case "cancelled":
    case "archived":
      return "done";
    default:
      return "stale";
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

async function readProjectMeta(
  projectsRoot: string,
  dirName: string
): Promise<{
  id: string;
  title: string;
  area: string;
  status: string;
  created: string;
  repo?: string;
} | null> {
  const projectDir = path.join(projectsRoot, dirName);
  const readmePath = path.join(projectDir, "README.md");
  let raw: string;
  try {
    raw = await fs.readFile(readmePath, "utf-8");
  } catch {
    return null;
  }
  const { frontmatter } = splitFrontmatter(raw);
  const id = asString(frontmatter.id) ?? dirName;
  const title = asString(frontmatter.title) ?? dirName;
  const area = asString(frontmatter.area) ?? "";
  const status = asString(frontmatter.status) ?? "";
  const created = asString(frontmatter.created) ?? "";
  const repo = asString(frontmatter.repo);
  return { id, title, area, status, created, repo };
}

async function gitText(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveGitPath(baseDir: string, rawPath: string): string {
  const trimmed = rawPath.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
}

async function resolveGitMetadata(worktreePath: string): Promise<GitMetadata> {
  const dotGitPath = path.join(worktreePath, ".git");
  const stat = await fs.stat(dotGitPath);
  let gitDir: string;
  if (stat.isDirectory()) {
    gitDir = dotGitPath;
  } else {
    const raw = await fs.readFile(dotGitPath, "utf-8");
    const prefix = "gitdir:";
    if (!raw.startsWith(prefix)) throw new Error("Invalid .git file");
    gitDir = resolveGitPath(worktreePath, raw.slice(prefix.length));
  }

  let commonGitDir = gitDir;
  try {
    const commonRaw = await fs.readFile(
      path.join(gitDir, "commondir"),
      "utf-8"
    );
    commonGitDir = resolveGitPath(gitDir, commonRaw);
  } catch {
    // Main worktrees do not have commondir; their git dir is the common dir.
  }

  return {
    gitDir,
    commonGitDir,
    headPath: path.join(gitDir, "HEAD"),
    indexPath: path.join(gitDir, "index"),
  };
}

function parseBranchFromHead(raw: string): string | null {
  const head = raw.trim();
  const headsPrefix = "ref: refs/heads/";
  if (head.startsWith(headsPrefix)) return head.slice(headsPrefix.length);
  return null;
}

async function readWorktreeBranch(
  worktreePath: string,
  options?: ScanProjectsOptions
): Promise<string | null> {
  const key = path.resolve(worktreePath);
  const now = Date.now();
  const cached = branchCache.get(key);
  if (cached && cached.expiresAt > now) return cached.branch;

  try {
    const metadata = await resolveGitMetadata(worktreePath);
    const stat = await fs.stat(metadata.headPath);
    if (
      cached &&
      cached.headPath === metadata.headPath &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      cached.expiresAt = now + branchTtlMs(options);
      return cached.branch;
    }
    const branch = parseBranchFromHead(
      await fs.readFile(metadata.headPath, "utf-8")
    );
    branchCache.set(key, {
      branch,
      headPath: metadata.headPath,
      mtimeMs: stat.mtimeMs,
      expiresAt: now + branchTtlMs(options),
    });
    return branch;
  } catch {
    return null;
  }
}

function watchIndexForDirtyInvalidation(
  indexPath: string,
  worktreeKey: string,
  mtimeMs: number
): void {
  if (indexWatchers.has(indexPath)) return;
  indexWatchers.set(indexPath, { worktreeKey, mtimeMs });
  try {
    const indexName = path.basename(indexPath);
    const watcher = watch(path.dirname(indexPath), (_event, filename) => {
      const changedName = typeof filename === "string" ? filename : undefined;
      if (
        changedName &&
        changedName !== indexName &&
        changedName !== `${indexName}.lock`
      ) {
        return;
      }
      dirtyAheadCache.delete(worktreeKey);
      invalidateProjectCache();
      void fs
        .stat(indexPath)
        .then((stat) => {
          const entry = indexWatchers.get(indexPath);
          if (entry) entry.mtimeMs = stat.mtimeMs;
        })
        .catch(() => undefined);
    });
    watcher.on("error", () => {
      watcher.close();
      const entry = indexWatchers.get(indexPath);
      if (entry) entry.watcher = undefined;
    });
    const entry = indexWatchers.get(indexPath);
    if (entry) entry.watcher = watcher;
  } catch {
    // Some repos have no index yet or disallow watching; TTL remains fallback.
  }
}

async function invalidateChangedIndexCaches(): Promise<void> {
  for (const [indexPath, entry] of indexWatchers) {
    try {
      const stat = await fs.stat(indexPath);
      if (stat.mtimeMs === entry.mtimeMs) continue;
      entry.mtimeMs = stat.mtimeMs;
      dirtyAheadCache.delete(entry.worktreeKey);
      invalidateProjectCache();
    } catch {
      dirtyAheadCache.delete(entry.worktreeKey);
      invalidateProjectCache();
    }
  }
}

async function readDirtyAheadCached(
  worktreePath: string,
  worktreeKey: string,
  options?: ScanProjectsOptions
): Promise<{ dirty: boolean; ahead: number }> {
  const now = Date.now();
  const cached = dirtyAheadCache.get(worktreeKey);
  if (cached && cached.expiresAt > now) {
    return { dirty: cached.dirty, ahead: cached.ahead };
  }

  try {
    const metadata = await resolveGitMetadata(worktreePath);
    const stat = await fs.stat(metadata.indexPath);
    watchIndexForDirtyInvalidation(
      metadata.indexPath,
      worktreeKey,
      stat.mtimeMs
    );
  } catch {
    // Dirty/ahead are best-effort status decorations.
  }

  let dirty = false;
  try {
    const status = await gitText(["status", "--porcelain"], worktreePath);
    dirty = status.trim().length > 0;
  } catch {
    dirty = false;
  }
  let ahead = 0;
  try {
    const out = await gitText(
      ["rev-list", "--count", "HEAD", "--not", "origin/main"],
      worktreePath
    );
    const n = Number.parseInt(out.trim(), 10);
    ahead = Number.isFinite(n) ? n : 0;
  } catch {
    ahead = 0;
  }

  dirtyAheadCache.set(worktreeKey, {
    dirty,
    ahead,
    expiresAt: now + dirtyAheadTtlMs(options),
  });
  return { dirty, ahead };
}

async function readWorktreeDetails(
  worktreePath: string,
  name: string,
  branch: string,
  options?: ScanProjectsOptions
): Promise<BoardWorktree> {
  const worktreeKey = await canonicalPath(worktreePath);
  const { dirty, ahead } = await readDirtyAheadCached(
    worktreePath,
    worktreeKey,
    options
  );
  return { name, path: worktreePath, branch, dirty, ahead };
}

function agentRunForPath(
  worktreePath: string,
  runsByCwd?: Map<string, AgentRunSummaryView>
): BoardAgentRunView | null {
  const run = runsByCwd?.get(path.resolve(worktreePath));
  if (!run) return null;
  return {
    runId: run.runId,
    label: run.label,
    cli: run.cli,
    status: run.status === "error" ? "failed" : run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}

async function readWorktreeView(params: {
  id: string;
  workerSlug: string;
  worktreePath: string;
  queueStatus: BoardWorktreeView["queueStatus"];
  name?: string;
  startedAt?: string;
  integratedAt?: string;
  startSha?: string;
  endSha?: string;
  runsByCwd?: Map<string, AgentRunSummaryView>;
  options?: ScanProjectsOptions;
}): Promise<BoardWorktreeView> {
  const branch = await readWorktreeBranch(params.worktreePath, params.options);
  const worktreeKey = await canonicalPath(params.worktreePath);
  const dirtyAhead = branch
    ? await readDirtyAheadCached(
        params.worktreePath,
        worktreeKey,
        params.options
      )
    : { dirty: false, ahead: 0 };
  const name =
    params.name ?? (params.workerSlug || path.basename(params.worktreePath));
  return {
    name,
    path: params.worktreePath,
    branch,
    dirty: dirtyAhead.dirty,
    ahead: dirtyAhead.ahead,
    id: params.id,
    workerSlug: params.workerSlug,
    worktreePath: params.worktreePath,
    queueStatus: params.queueStatus,
    agentRun: agentRunForPath(params.worktreePath, params.runsByCwd),
    startedAt: params.startedAt,
    integratedAt: params.integratedAt,
    startSha: params.startSha,
    endSha: params.endSha,
  };
}

async function buildProjectWorktreeViews(
  meta: ProjectMeta,
  legacyWorktrees: BoardWorktree[],
  options?: ScanProjectsOptions
): Promise<BoardWorktreeView[]> {
  const getSpace = options?.getSpace;
  const space = getSpace ? await getSpace(meta.id) : null;
  const views: BoardWorktreeView[] = [];
  const covered = new Set<string>();
  const addCovered = async (worktreePath: string): Promise<void> => {
    covered.add(await canonicalPath(worktreePath));
  };

  if (space) {
    for (const entry of space.queue) {
      views.push(
        await readWorktreeView({
          id: entry.id,
          workerSlug: entry.workerSlug,
          worktreePath: entry.worktreePath,
          queueStatus: entry.status,
          startedAt: entry.createdAt,
          integratedAt: entry.integratedAt,
          startSha: entry.startSha,
          endSha: entry.endSha,
          runsByCwd: options?.runsByCwd,
          options,
        })
      );
      await addCovered(entry.worktreePath);
    }
    if (
      space.worktreePath &&
      !covered.has(await canonicalPath(space.worktreePath))
    ) {
      views.push(
        await readWorktreeView({
          id: `${meta.id}:_space`,
          workerSlug: "_space",
          worktreePath: space.worktreePath,
          queueStatus: null,
          runsByCwd: options?.runsByCwd,
          options,
        })
      );
    }
    return views;
  }

  for (const wt of legacyWorktrees) {
    views.push({
      ...wt,
      id: `${meta.id}:${wt.name}`,
      workerSlug: wt.name,
      worktreePath: wt.path,
      queueStatus: null,
      agentRun: agentRunForPath(wt.path, options?.runsByCwd),
    });
  }
  if (views.length > 0) return views;

  if (!meta.repo) return [];
  const worktreePath = expandPath(meta.repo);
  return [
    await readWorktreeView({
      id: `${meta.id}:main`,
      workerSlug: "main",
      worktreePath,
      queueStatus: null,
      name: "main",
      runsByCwd: options?.runsByCwd,
      options,
    }),
  ];
}

function branchMatchesProject(branch: string, id: string): boolean {
  return (
    branch === `space/${id}` ||
    branch.startsWith(`space/${id}/`) ||
    branch.startsWith(`${id}/`)
  );
}

async function isGitWorktree(dir: string): Promise<boolean> {
  return pathExists(path.join(dir, ".git"));
}

type ProjectMeta = {
  id: string;
  title: string;
  area: string;
  status: string;
  created: string;
  repo?: string;
};

type WorktreeIndex = Map<string, BoardWorktree[]>;

function branchMatchesAnyProject(
  branch: string,
  projectIds: Set<string>
): boolean {
  for (const id of projectIds) {
    if (branchMatchesProject(branch, id)) return true;
  }
  return false;
}

function addWorktreeToIndex(index: WorktreeIndex, wt: BoardWorktree): void {
  const existing = index.get(wt.branch) ?? [];
  existing.push(wt);
  index.set(wt.branch, existing);
}

function startsWithInactiveProjectId(
  name: string,
  activeProjectIds: Set<string>
): boolean {
  if (!name.startsWith("PRO-")) return false;
  for (const projectId of activeProjectIds) {
    if (name === projectId || name.startsWith(`${projectId}-`)) return false;
  }
  return true;
}

async function scanWorktreePathsFromRoot(
  worktreesRoot: string,
  activeProjectIds: Set<string>,
  activeRepoNames?: Set<string>
): Promise<Array<{ path: string; name: string }>> {
  let projectDirs: import("node:fs").Dirent[];
  try {
    projectDirs = await fs.readdir(worktreesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ path: string; name: string }> = [];
  for (const proj of projectDirs) {
    if (!proj.isDirectory()) continue;
    if (SKIP_DIRS.has(proj.name)) continue;
    if (startsWithInactiveProjectId(proj.name, activeProjectIds)) continue;
    if (
      activeRepoNames &&
      !proj.name.startsWith("PRO-") &&
      !activeRepoNames.has(proj.name)
    ) {
      continue;
    }
    const projPath = path.join(worktreesRoot, proj.name);
    let inner: import("node:fs").Dirent[];
    try {
      inner = await fs.readdir(projPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of inner) {
      if (!entry.isDirectory()) continue;
      if (startsWithInactiveProjectId(entry.name, activeProjectIds)) continue;
      const wtPath = path.join(projPath, entry.name);
      if (!(await isGitWorktree(wtPath))) continue;
      out.push({ path: wtPath, name: entry.name });
    }
  }
  return out;
}

async function scanWorktreeRefsFromRepo(
  repo: string,
  options?: ScanProjectsOptions
): Promise<Array<{ path: string; name: string }>> {
  const repoPath = expandPath(repo);
  const now = Date.now();
  const cached = repoWorktreeCache.get(repoPath);
  if (cached && cached.expiresAt > now) return cached.value;

  const out: Array<{ path: string; name: string }> = [];
  try {
    let commonGitDir: string;
    if (
      (await pathExists(path.join(repoPath, "HEAD"))) &&
      (await pathExists(path.join(repoPath, "objects")))
    ) {
      commonGitDir = repoPath;
    } else {
      const metadata = await resolveGitMetadata(repoPath);
      commonGitDir = metadata.commonGitDir;
      out.push({ path: repoPath, name: path.basename(repoPath) });
    }

    const worktreesDir = path.join(commonGitDir, "worktrees");
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(worktreesDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metadataDir = path.join(worktreesDir, entry.name);
      let gitdirRaw: string;
      try {
        gitdirRaw = await fs.readFile(
          path.join(metadataDir, "gitdir"),
          "utf-8"
        );
      } catch {
        continue;
      }
      const gitdirPath = resolveGitPath(metadataDir, gitdirRaw);
      const worktreePath = path.dirname(gitdirPath);
      out.push({ path: worktreePath, name: path.basename(worktreePath) });
    }
  } catch {
    return [];
  }
  repoWorktreeCache.set(repoPath, {
    value: out,
    expiresAt: now + repoWorktreeTtlMs(options),
  });
  return out;
}

async function canonicalPath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

async function buildWorktreeIndex(
  metas: ProjectMeta[],
  worktreesRoot: string,
  options?: ScanProjectsOptions
): Promise<WorktreeIndex> {
  const activeMetas = metas.filter(
    (meta) => statusToGroup(meta.status) !== "done"
  );
  const activeProjectIds = new Set(activeMetas.map((meta) => meta.id));
  if (activeProjectIds.size === 0) return new Map();

  const repos = [
    ...new Set(
      activeMetas
        .map((meta) => meta.repo)
        .filter(
          (repo): repo is string => typeof repo === "string" && repo !== ""
        )
    ),
  ];
  const activeRepoNames =
    repos.length > 0 &&
    activeMetas.every(
      (meta) => typeof meta.repo === "string" && meta.repo !== ""
    )
      ? new Set(repos.map((repo) => path.basename(expandPath(repo))))
      : undefined;

  const index: WorktreeIndex = new Map();
  const detailsByPath = new Map<string, BoardWorktree>();

  const readMatchedWorktree = async (
    worktreePath: string,
    name: string,
    branch: string
  ): Promise<BoardWorktree | null> => {
    if (!branchMatchesAnyProject(branch, activeProjectIds)) return null;
    const key = await canonicalPath(worktreePath);
    const cached = detailsByPath.get(key);
    if (cached) return cached;
    const wt = await readWorktreeDetails(worktreePath, name, branch, options);
    detailsByPath.set(key, wt);
    return wt;
  };

  const rootPaths = await scanWorktreePathsFromRoot(
    worktreesRoot,
    activeProjectIds,
    activeRepoNames
  );
  const rootWorktrees = await Promise.all(
    rootPaths.map(async (candidate) => {
      const branch = await readWorktreeBranch(candidate.path, options);
      if (!branch) return null;
      return readMatchedWorktree(candidate.path, candidate.name, branch);
    })
  );
  for (const wt of rootWorktrees) {
    if (wt) addWorktreeToIndex(index, wt);
  }

  const repoRefs = await Promise.all(
    repos.map((repo) => scanWorktreeRefsFromRepo(repo, options))
  );
  const repoWorktrees = await Promise.all(
    repoRefs.flat().map(async (ref) => {
      const branch = await readWorktreeBranch(ref.path, options);
      if (!branch) return null;
      return readMatchedWorktree(ref.path, ref.name, branch);
    })
  );
  for (const wt of repoWorktrees) {
    if (wt) addWorktreeToIndex(index, wt);
  }

  return index;
}

async function lookupWorktrees(
  index: WorktreeIndex,
  id: string
): Promise<BoardWorktree[]> {
  const dedup = new Map<string, BoardWorktree>();
  for (const [branch, worktrees] of index) {
    if (!branchMatchesProject(branch, id)) continue;
    for (const wt of worktrees) {
      const key = await canonicalPath(wt.path);
      if (!dedup.has(key)) dedup.set(key, wt);
    }
  }
  const result = [...dedup.values()];
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export async function scanProjects(
  projectsRoot: string,
  includeDone: boolean,
  worktreesRoot?: string,
  options?: ScanProjectsOptions
): Promise<BoardProject[]> {
  const wtRoot = worktreesRoot ?? expandPath("~/.worktrees");
  const key = scanCacheKey(projectsRoot, wtRoot, includeDone, options);
  const cached = projectResultCache.get(key);
  if (cached) {
    await invalidateChangedIndexCaches();
    const current = projectResultCache.get(key);
    if (!current) {
      return refreshProjectCache(
        key,
        projectsRoot,
        includeDone,
        wtRoot,
        options
      );
    }
    if (current.expiresAt <= Date.now()) {
      void refreshProjectCache(
        key,
        projectsRoot,
        includeDone,
        wtRoot,
        options
      ).catch(() => undefined);
    }
    return current.value;
  }
  return refreshProjectCache(key, projectsRoot, includeDone, wtRoot, options);
}

function refreshProjectCache(
  key: string,
  projectsRoot: string,
  includeDone: boolean,
  worktreesRoot?: string,
  options?: ScanProjectsOptions
): Promise<BoardProject[]> {
  const inFlight = inFlightScans.get(key);
  if (inFlight) return inFlight;

  const version = projectCacheVersion;
  const promise = scanProjectsUncached(
    projectsRoot,
    includeDone,
    worktreesRoot,
    options
  )
    .then((items) => {
      if (version === projectCacheVersion) {
        projectResultCache.set(key, {
          value: items,
          expiresAt: Date.now() + projectCacheTtlMs(options),
        });
      }
      return items;
    })
    .finally(() => {
      if (inFlightScans.get(key) === promise) inFlightScans.delete(key);
    });

  inFlightScans.set(key, promise);
  return promise;
}

async function scanProjectsUncached(
  projectsRoot: string,
  includeDone: boolean,
  worktreesRoot?: string,
  options?: ScanProjectsOptions
): Promise<BoardProject[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const wtRoot = worktreesRoot ?? expandPath("~/.worktrees");

  const projectEntries = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !SKIP_DIRS.has(entry.name) &&
      PROJECT_DIR_PATTERN.test(entry.name)
  );
  const metas = (
    await Promise.all(
      projectEntries.map((entry) => readProjectMeta(projectsRoot, entry.name))
    )
  ).filter((meta): meta is ProjectMeta => meta !== null);
  const worktreeIndex = await buildWorktreeIndex(metas, wtRoot, options);

  const projects: BoardProject[] = [];
  for (const meta of metas) {
    const group = statusToGroup(meta.status);
    if (!includeDone && group === "done") continue;
    const worktrees = await buildProjectWorktreeViews(
      meta,
      await lookupWorktrees(worktreeIndex, meta.id),
      options
    );
    projects.push({
      id: meta.id,
      title: meta.title,
      area: meta.area,
      status: meta.status,
      group,
      created: meta.created,
      worktrees,
    });
  }

  projects.sort((a, b) => {
    const g = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
    if (g !== 0) return g;
    return b.created.localeCompare(a.created);
  });

  return projects;
}
