import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { GatewayConfig } from "@aihub/shared";
import { getProject } from "./store.js";

const execFileAsync = promisify(execFile);
const DEFAULT_LEASE_TTL_SECONDS = 60 * 60;

export type IntegrationStatus =
  | "pending"
  | "integrated"
  | "conflict"
  | "skipped"
  | "stale_worker";

export type IntegrationEntry = {
  id: string;
  workerSlug: string;
  runMode: "worktree" | "clone";
  worktreePath: string;
  startSha?: string;
  endSha?: string;
  shas: string[];
  status: IntegrationStatus;
  createdAt: string;
  integratedAt?: string;
  error?: string;
  staleAgainstSha?: string;
};

export type ProjectSpace = {
  version: 1;
  projectId: string;
  branch: string;
  worktreePath: string;
  baseBranch: string;
  integrationBlocked: boolean;
  queue: IntegrationEntry[];
  updatedAt: string;
};

export type SpaceCommitSummary = {
  sha: string;
  subject: string;
  author: string;
  date: string;
};

export type SpaceContribution = {
  entry: IntegrationEntry;
  commits: SpaceCommitSummary[];
  diff: string;
  conflictFiles: string[];
};

export type SpaceWriteLease = {
  holder: string;
  acquiredAt: string;
  expiresAt: string;
};

export type SpaceWriteLeaseResult =
  | { ok: true; data: SpaceWriteLease | null }
  | { ok: false; error: string };

export type ProjectSpaceResult =
  | { ok: true; data: ProjectSpace }
  | { ok: false; error: string };

export type RecordWorkerDeliveryInput = {
  projectId: string;
  workerSlug: string;
  runMode: "worktree" | "clone";
  worktreePath: string;
  startSha?: string;
  endSha?: string;
};

function expandPath(p: string): string {
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

function getProjectsRoot(config: GatewayConfig): string {
  const root = config.projects?.root ?? "~/projects";
  return expandPath(root);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trimEnd();
}

async function runGitInRepo(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trimEnd();
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function cloneRemoteName(projectId: string): string {
  return `agent-${projectId}`.toLowerCase();
}

export function isSpaceWriteLeaseEnabled(): boolean {
  const raw = (process.env.AIHUB_SPACE_WRITE_LEASE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isSpaceAutoRebaseEnabled(): boolean {
  const raw = (process.env.AIHUB_SPACE_AUTO_REBASE ?? "true")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeQueue(input: unknown): IntegrationEntry[] {
  if (!Array.isArray(input)) return [];
  const entries: IntegrationEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const workerSlug =
      typeof row.workerSlug === "string" ? row.workerSlug.trim() : "";
    const runMode = row.runMode === "clone" ? "clone" : "worktree";
    const worktreePath =
      typeof row.worktreePath === "string" ? row.worktreePath.trim() : "";
    const createdAt =
      typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString();
    const status: IntegrationStatus =
      row.status === "integrated" ||
      row.status === "conflict" ||
      row.status === "skipped" ||
      row.status === "stale_worker"
        ? row.status
        : "pending";
    const shas = Array.isArray(row.shas)
      ? row.shas
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];
    if (!id || !workerSlug || !worktreePath) continue;
    entries.push({
      id,
      workerSlug,
      runMode,
      worktreePath,
      startSha: typeof row.startSha === "string" ? row.startSha : undefined,
      endSha: typeof row.endSha === "string" ? row.endSha : undefined,
      shas,
      status,
      createdAt,
      integratedAt:
        typeof row.integratedAt === "string" ? row.integratedAt : undefined,
      error: typeof row.error === "string" ? row.error : undefined,
      staleAgainstSha:
        typeof row.staleAgainstSha === "string"
          ? row.staleAgainstSha
          : undefined,
    });
  }
  return entries;
}

async function resolveProjectContext(config: GatewayConfig, projectId: string): Promise<{
  projectId: string;
  projectDir: string;
  repo: string;
  spaceFilePath: string;
  leaseFilePath: string;
}> {
  const project = await getProject(config, projectId);
  if (!project.ok) throw new Error(project.error);

  const repoRaw =
    typeof project.data.frontmatter.repo === "string"
      ? project.data.frontmatter.repo
      : "";
  if (!repoRaw.trim()) throw new Error("Project repo not set");

  const repo = expandPath(repoRaw.trim());
  const projectDir = project.data.absolutePath;
  return {
    projectId,
    projectDir,
    repo,
    spaceFilePath: path.join(projectDir, "space.json"),
    leaseFilePath: path.join(projectDir, "space-lease.json"),
  };
}

async function readSpaceFile(filePath: string): Promise<ProjectSpace | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectId =
      typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
    const branch = typeof parsed.branch === "string" ? parsed.branch.trim() : "";
    const worktreePath =
      typeof parsed.worktreePath === "string" ? parsed.worktreePath.trim() : "";
    const baseBranch =
      typeof parsed.baseBranch === "string" ? parsed.baseBranch.trim() : "main";
    if (!projectId || !branch || !worktreePath) return null;
    return {
      version: 1,
      projectId,
      branch,
      worktreePath,
      baseBranch: baseBranch || "main",
      integrationBlocked: parsed.integrationBlocked === true,
      queue: normalizeQueue(parsed.queue),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeSpaceFile(filePath: string, space: ProjectSpace): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(space, null, 2), "utf8");
}

async function readLeaseFile(filePath: string): Promise<SpaceWriteLease | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const holder = typeof parsed.holder === "string" ? parsed.holder.trim() : "";
    const acquiredAt =
      typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : "";
    const expiresAt =
      typeof parsed.expiresAt === "string" ? parsed.expiresAt : "";
    if (!holder || !acquiredAt || !expiresAt) return null;
    return { holder, acquiredAt, expiresAt };
  } catch {
    return null;
  }
}

async function writeLeaseFile(
  filePath: string,
  lease: SpaceWriteLease
): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(lease, null, 2), "utf8");
}

function isLeaseExpired(lease: SpaceWriteLease, now = Date.now()): boolean {
  const leaseTs = Date.parse(lease.expiresAt);
  return Number.isFinite(leaseTs) ? leaseTs <= now : true;
}

async function ensureWorktree(
  repo: string,
  worktreePath: string,
  branch: string,
  baseBranch: string
): Promise<void> {
  if (await isGitRepo(worktreePath)) return;
  const exists = await dirExists(worktreePath);
  if (exists) {
    await fs.rm(worktreePath, { recursive: true, force: true });
  }
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  try {
    await runGitInRepo(repo, [
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      baseBranch,
    ]);
  } catch {
    await runGitInRepo(repo, ["worktree", "add", worktreePath, branch]);
  }
}

async function collectCommitShas(
  worktreePath: string,
  startSha?: string,
  endSha?: string
): Promise<string[]> {
  const start = (startSha ?? "").trim();
  const end = (endSha ?? "").trim();
  if (!start || !end || start === end) return [];
  try {
    const out = await runGit(worktreePath, ["rev-list", "--reverse", `${start}..${end}`]);
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function getGitHead(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(cwd, ["rev-parse", "HEAD"]);
    const value = out.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function listConflictFiles(cwd: string): Promise<string[]> {
  try {
    const out = await runGit(cwd, ["diff", "--name-only", "--diff-filter=U"]);
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function parseCommitSummaries(
  cwd: string,
  shas: string[]
): Promise<SpaceCommitSummary[]> {
  const commits: SpaceCommitSummary[] = [];
  for (const sha of shas) {
    try {
      const row = await runGit(cwd, [
        "show",
        "-s",
        "--date=iso-strict",
        "--format=%H%x09%an%x09%ad%x09%s",
        sha,
      ]);
      const [line] = row.split(/\r?\n/);
      const [commitSha = "", author = "", date = "", ...subjectParts] =
        line.split("\t");
      if (!commitSha) continue;
      commits.push({
        sha: commitSha,
        author,
        date,
        subject: subjectParts.join("\t"),
      });
    } catch {
      // Skip commits no longer reachable.
    }
  }
  return commits;
}

async function collectPatchForShas(cwd: string, shas: string[]): Promise<string> {
  if (shas.length === 0) return "";
  try {
    return await runGit(cwd, ["show", "--no-color", "--patch", ...shas]);
  } catch {
    return "";
  }
}

async function autoRebaseWorkerOntoSpace(
  worktreePath: string,
  startSha: string,
  spaceHeadSha: string
): Promise<{ ok: true; endSha: string } | { ok: false; error: string }> {
  try {
    await runGit(worktreePath, [
      "rebase",
      "--onto",
      spaceHeadSha,
      startSha,
      "HEAD",
    ]);
  } catch (error) {
    await runGit(worktreePath, ["rebase", "--abort"]).catch(() => {});
    return {
      ok: false,
      error: error instanceof Error ? error.message : "git rebase failed",
    };
  }
  const endSha = await getGitHead(worktreePath);
  if (!endSha) {
    return { ok: false, error: "Failed to resolve rebased HEAD" };
  }
  return { ok: true, endSha };
}

async function fetchCloneShas(
  repo: string,
  projectId: string,
  shas: string[]
): Promise<void> {
  if (shas.length === 0) return;
  const remote = cloneRemoteName(projectId);
  await runGitInRepo(repo, ["fetch", remote, ...shas]);
}

function buildSpaceDefaults(input: {
  config: GatewayConfig;
  projectId: string;
  existing?: ProjectSpace | null;
  baseBranch?: string;
}): ProjectSpace {
  const branch = input.existing?.branch || `space/${input.projectId}`;
  const baseBranch =
    input.existing?.baseBranch || input.baseBranch?.trim() || "main";
  const worktreePath =
    input.existing?.worktreePath ||
    path.join(getProjectsRoot(input.config), ".workspaces", input.projectId, "_space");
  return {
    version: 1,
    projectId: input.projectId,
    branch,
    baseBranch,
    worktreePath,
    integrationBlocked: input.existing?.integrationBlocked ?? false,
    queue: input.existing?.queue ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureProjectSpace(
  config: GatewayConfig,
  projectId: string,
  baseBranch?: string
): Promise<ProjectSpace> {
  const context = await resolveProjectContext(config, projectId);
  if (!(await isGitRepo(context.repo))) {
    throw new Error("Not a git repository");
  }

  const existing = await readSpaceFile(context.spaceFilePath);
  const space = buildSpaceDefaults({
    config,
    projectId,
    existing,
    baseBranch,
  });

  await ensureWorktree(
    context.repo,
    space.worktreePath,
    space.branch,
    space.baseBranch
  );

  space.updatedAt = new Date().toISOString();
  await writeSpaceFile(context.spaceFilePath, space);
  return space;
}

export async function getProjectSpace(
  config: GatewayConfig,
  projectId: string
): Promise<ProjectSpaceResult> {
  let context;
  try {
    context = await resolveProjectContext(config, projectId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Project lookup failed",
    };
  }

  const space = await readSpaceFile(context.spaceFilePath);
  if (!space) {
    return { ok: false, error: "Project space not found" };
  }
  return { ok: true, data: space };
}

export async function getProjectSpaceCommitLog(
  config: GatewayConfig,
  projectId: string,
  limit = 20
): Promise<SpaceCommitSummary[]> {
  const context = await resolveProjectContext(config, projectId);
  const space = await readSpaceFile(context.spaceFilePath);
  if (!space) throw new Error("Project space not found");
  if (!(await isGitRepo(space.worktreePath))) return [];

  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.floor(limit)))
    : 20;
  const range = `${space.baseBranch || "main"}..HEAD`;
  const out = await runGit(space.worktreePath, [
    "log",
    "--date=iso-strict",
    "--pretty=format:%H%x09%an%x09%ad%x09%s",
    "--max-count",
    String(safeLimit),
    range,
  ]).catch(() => "");
  if (!out.trim()) return [];

  return out
    .split(/\r?\n/)
    .map((line) => {
      const [sha = "", author = "", date = "", ...subjectParts] =
        line.split("\t");
      if (!sha) return null;
      return {
        sha,
        author,
        date,
        subject: subjectParts.join("\t"),
      } satisfies SpaceCommitSummary;
    })
    .filter((row): row is SpaceCommitSummary => row !== null);
}

export async function getProjectSpaceContribution(
  config: GatewayConfig,
  projectId: string,
  entryId: string
): Promise<SpaceContribution> {
  const context = await resolveProjectContext(config, projectId);
  const space = await readSpaceFile(context.spaceFilePath);
  if (!space) throw new Error("Project space not found");

  const entry = space.queue.find((item) => item.id === entryId);
  if (!entry) throw new Error("Space integration entry not found");

  const preferredCwds = [entry.worktreePath, space.worktreePath, context.repo];
  let cwd = space.worktreePath;
  for (const candidate of preferredCwds) {
    if (await isGitRepo(candidate)) {
      cwd = candidate;
      break;
    }
  }

  const commits = await parseCommitSummaries(cwd, entry.shas);
  const diff = await collectPatchForShas(cwd, entry.shas);
  const conflictFiles =
    entry.status === "conflict" ? await listConflictFiles(space.worktreePath) : [];

  return { entry, commits, diff, conflictFiles };
}

export async function getProjectSpaceConflictContext(
  config: GatewayConfig,
  projectId: string,
  entryId: string
): Promise<{ space: ProjectSpace; entry: IntegrationEntry; conflictFiles: string[] }> {
  const context = await resolveProjectContext(config, projectId);
  const space = await readSpaceFile(context.spaceFilePath);
  if (!space) throw new Error("Project space not found");
  const entry = space.queue.find(
    (item) => item.id === entryId && item.status === "conflict"
  );
  if (!entry) throw new Error("Space conflict entry not found");
  const conflictFiles = await listConflictFiles(space.worktreePath);
  return { space, entry, conflictFiles };
}

export async function pruneProjectRepoWorktrees(
  config: GatewayConfig,
  projectId: string
): Promise<void> {
  const context = await resolveProjectContext(config, projectId);
  if (!(await isGitRepo(context.repo))) return;
  await runGitInRepo(context.repo, ["worktree", "prune"]).catch(() => {});
}

export async function getProjectSpaceWriteLease(
  config: GatewayConfig,
  projectId: string
): Promise<SpaceWriteLeaseResult> {
  if (!isSpaceWriteLeaseEnabled()) {
    return { ok: true, data: null };
  }
  let context;
  try {
    context = await resolveProjectContext(config, projectId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Project lookup failed",
    };
  }

  const lease = await readLeaseFile(context.leaseFilePath);
  if (!lease) return { ok: true, data: null };
  if (isLeaseExpired(lease)) {
    await fs.rm(context.leaseFilePath, { force: true }).catch(() => {});
    return { ok: true, data: null };
  }
  return { ok: true, data: lease };
}

export async function acquireProjectSpaceWriteLease(
  config: GatewayConfig,
  projectId: string,
  input: { holder: string; ttlSeconds?: number; force?: boolean }
): Promise<SpaceWriteLeaseResult> {
  if (!isSpaceWriteLeaseEnabled()) {
    return { ok: false, error: "Space write lease is disabled" };
  }
  const holder = input.holder.trim();
  if (!holder) {
    return { ok: false, error: "holder is required" };
  }

  let context;
  try {
    context = await resolveProjectContext(config, projectId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Project lookup failed",
    };
  }

  const existing = await readLeaseFile(context.leaseFilePath);
  if (
    existing &&
    !isLeaseExpired(existing) &&
    existing.holder !== holder &&
    !input.force
  ) {
    return {
      ok: false,
      error: `Space lease already held by ${existing.holder}`,
    };
  }

  const ttlSeconds = Number.isFinite(input.ttlSeconds)
    ? Math.max(30, Math.min(24 * 60 * 60, Math.floor(input.ttlSeconds ?? 0)))
    : DEFAULT_LEASE_TTL_SECONDS;
  const now = Date.now();
  const lease: SpaceWriteLease = {
    holder,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  };
  await writeLeaseFile(context.leaseFilePath, lease);
  return { ok: true, data: lease };
}

export async function releaseProjectSpaceWriteLease(
  config: GatewayConfig,
  projectId: string,
  input: { holder?: string; force?: boolean }
): Promise<SpaceWriteLeaseResult> {
  if (!isSpaceWriteLeaseEnabled()) {
    return { ok: true, data: null };
  }
  let context;
  try {
    context = await resolveProjectContext(config, projectId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Project lookup failed",
    };
  }

  const existing = await readLeaseFile(context.leaseFilePath);
  if (!existing || isLeaseExpired(existing)) {
    await fs.rm(context.leaseFilePath, { force: true }).catch(() => {});
    return { ok: true, data: null };
  }
  if (
    !input.force &&
    input.holder &&
    input.holder.trim() &&
    existing.holder !== input.holder.trim()
  ) {
    return {
      ok: false,
      error: `Space lease held by ${existing.holder}`,
    };
  }
  await fs.rm(context.leaseFilePath, { force: true });
  return { ok: true, data: null };
}

async function persistProjectSpace(
  config: GatewayConfig,
  projectId: string,
  updater: (space: ProjectSpace) => Promise<ProjectSpace> | ProjectSpace
): Promise<ProjectSpace> {
  const context = await resolveProjectContext(config, projectId);
  const existing = await readSpaceFile(context.spaceFilePath);
  if (!existing) throw new Error("Project space not found");
  const updated = await updater(existing);
  updated.updatedAt = new Date().toISOString();
  await writeSpaceFile(context.spaceFilePath, updated);
  return updated;
}

export async function integrateProjectSpaceQueue(
  config: GatewayConfig,
  projectId: string,
  options?: { resume?: boolean }
): Promise<ProjectSpace> {
  const context = await resolveProjectContext(config, projectId);
  if (!(await isGitRepo(context.repo))) {
    throw new Error("Not a git repository");
  }

  return persistProjectSpace(config, projectId, async (space) => {
    const next: ProjectSpace = {
      ...space,
      queue: [...space.queue],
      integrationBlocked: options?.resume ? false : space.integrationBlocked,
    };

    if (next.integrationBlocked) {
      return next;
    }

    for (const item of next.queue) {
      if (item.status !== "pending") continue;
      if (item.shas.length === 0) {
        item.status = "skipped";
        item.integratedAt = new Date().toISOString();
        continue;
      }
      if (item.runMode === "clone") {
        try {
          await fetchCloneShas(context.repo, projectId, item.shas);
        } catch (error) {
          item.status = "conflict";
          item.error =
            error instanceof Error ? error.message : "git fetch failed";
          next.integrationBlocked = true;
          break;
        }
      }

      try {
        await runGit(next.worktreePath, ["cherry-pick", "-x", ...item.shas]);
        item.status = "integrated";
        item.integratedAt = new Date().toISOString();
        item.error = undefined;
      } catch (error) {
        await runGit(next.worktreePath, ["cherry-pick", "--abort"]).catch(
          () => {}
        );
        item.status = "conflict";
        item.error =
          error instanceof Error ? error.message : "git cherry-pick failed";
        next.integrationBlocked = true;
        break;
      }
    }

    return next;
  });
}

export async function recordWorkerDelivery(
  config: GatewayConfig,
  input: RecordWorkerDeliveryInput
): Promise<ProjectSpace> {
  const space = await ensureProjectSpace(config, input.projectId);
  let startSha = input.startSha;
  let endSha = input.endSha;
  let staleAgainstSha: string | undefined;
  let staleError: string | undefined;

  const spaceHead = await getGitHead(space.worktreePath);
  if (spaceHead && startSha && startSha.trim() && startSha !== spaceHead) {
    if (input.runMode === "worktree") {
      if (isSpaceAutoRebaseEnabled()) {
        const rebased = await autoRebaseWorkerOntoSpace(
          input.worktreePath,
          startSha,
          spaceHead
        );
        if (rebased.ok) {
          startSha = spaceHead;
          endSha = rebased.endSha;
        } else {
          staleError = `auto-rebase failed: ${rebased.error}`;
        }
      }
    } else {
      staleAgainstSha = spaceHead;
      staleError =
        "worker is stale vs Space HEAD; rebase required before integration";
    }
  }

  const shas = await collectCommitShas(input.worktreePath, startSha, endSha);

  const now = new Date().toISOString();
  await persistProjectSpace(config, input.projectId, (current) => {
    const entry: IntegrationEntry = {
      id: `${input.workerSlug}:${Date.now()}`,
      workerSlug: input.workerSlug,
      runMode: input.runMode,
      worktreePath: input.worktreePath,
      startSha,
      endSha,
      shas,
      status: staleAgainstSha
        ? "stale_worker"
        : shas.length > 0
          ? "pending"
          : "skipped",
      createdAt: now,
      integratedAt: shas.length > 0 ? undefined : now,
      staleAgainstSha,
      error: staleError,
    };
    return {
      ...current,
      queue: [...current.queue, entry],
    };
  });

  if (space.integrationBlocked || shas.length === 0 || staleAgainstSha) {
    const refreshed = await getProjectSpace(config, input.projectId);
    if (!refreshed.ok) throw new Error(refreshed.error);
    await pruneProjectRepoWorktrees(config, input.projectId).catch(() => {});
    return refreshed.data;
  }

  const integrated = await integrateProjectSpaceQueue(config, input.projectId);
  await pruneProjectRepoWorktrees(config, input.projectId).catch(() => {});
  return integrated;
}
