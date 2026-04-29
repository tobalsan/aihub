import { execFile } from "node:child_process";
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

export type BoardProject = {
  id: string;
  title: string;
  area: string;
  status: string;
  group: BoardProjectGroup;
  created: string;
  worktrees: BoardWorktree[];
};

const PROJECT_DIR_PATTERN = /^PRO-/;
const SKIP_DIRS = new Set([".workspaces", ".archive", ".done", ".trash"]);

const GROUP_ORDER: Record<BoardProjectGroup, number> = {
  review: 0,
  active: 1,
  stale: 2,
  done: 3,
};

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

async function readWorktreeBranch(
  worktreePath: string
): Promise<string | null> {
  try {
    return (
      await gitText(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)
    ).trim();
  } catch {
    return null;
  }
}

async function readWorktreeDetails(
  worktreePath: string,
  name: string,
  branch: string
): Promise<BoardWorktree> {
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
  return { name, path: worktreePath, branch, dirty, ahead };
}

function branchMatchesProject(branch: string, id: string): boolean {
  return (
    branch === `space/${id}` ||
    branch.startsWith(`space/${id}/`) ||
    branch.startsWith(`${id}/`)
  );
}

async function isGitWorktree(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
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

async function scanWorktreePathsFromRoot(
  worktreesRoot: string
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
    const projPath = path.join(worktreesRoot, proj.name);
    let inner: import("node:fs").Dirent[];
    try {
      inner = await fs.readdir(projPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of inner) {
      if (!entry.isDirectory()) continue;
      const wtPath = path.join(projPath, entry.name);
      if (!(await isGitWorktree(wtPath))) continue;
      out.push({ path: wtPath, name: entry.name });
    }
  }
  return out;
}

async function scanWorktreeRefsFromRepo(
  repo: string
): Promise<Array<{ path: string; name: string; branch: string }>> {
  const repoPath = expandPath(repo);
  let raw: string;
  try {
    raw = await gitText(["worktree", "list", "--porcelain"], repoPath);
  } catch {
    return [];
  }
  const out: Array<{ path: string; name: string; branch: string }> = [];
  const blocks = raw.split(/\n\s*\n/);
  for (const block of blocks) {
    let wtPath: string | undefined;
    let branch: string | undefined;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        wtPath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        branch = ref.startsWith("refs/heads/")
          ? ref.slice("refs/heads/".length)
          : ref;
      }
    }
    if (!wtPath || !branch) continue;
    out.push({ path: wtPath, name: path.basename(wtPath), branch });
  }
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
  worktreesRoot: string
): Promise<WorktreeIndex> {
  const activeProjectIds = new Set(
    metas
      .filter((meta) => statusToGroup(meta.status) !== "done")
      .map((meta) => meta.id)
  );
  if (activeProjectIds.size === 0) return new Map();

  const repos = [
    ...new Set(
      metas
        .filter((meta) => statusToGroup(meta.status) !== "done")
        .map((meta) => meta.repo)
        .filter(
          (repo): repo is string => typeof repo === "string" && repo !== ""
        )
    ),
  ];

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
    const wt = await readWorktreeDetails(worktreePath, name, branch);
    detailsByPath.set(key, wt);
    return wt;
  };

  const rootPaths = await scanWorktreePathsFromRoot(worktreesRoot);
  const rootWorktrees = await Promise.all(
    rootPaths.map(async (candidate) => {
      const branch = await readWorktreeBranch(candidate.path);
      if (!branch) return null;
      return readMatchedWorktree(candidate.path, candidate.name, branch);
    })
  );
  for (const wt of rootWorktrees) {
    if (wt) addWorktreeToIndex(index, wt);
  }

  const repoRefs = await Promise.all(
    repos.map((repo) => scanWorktreeRefsFromRepo(repo))
  );
  const repoWorktrees = await Promise.all(
    repoRefs
      .flat()
      .map((ref) => readMatchedWorktree(ref.path, ref.name, ref.branch))
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
  worktreesRoot?: string
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
  const worktreeIndex = await buildWorktreeIndex(metas, wtRoot);

  const projects: BoardProject[] = [];
  for (const meta of metas) {
    const group = statusToGroup(meta.status);
    if (!includeDone && group === "done") continue;
    const worktrees = await lookupWorktrees(worktreeIndex, meta.id);
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
