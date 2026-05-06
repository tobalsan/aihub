import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { dirExists } from "../util/fs.js";
import type { SpaceCommitSummary } from "./space-state.js";

const execFileAsync = promisify(execFile);

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trimEnd();
}

export async function runGitInRepo(
  repo: string,
  args: string[]
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trimEnd();
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export function cloneRemoteName(projectId: string): string {
  return `agent-${projectId}`.toLowerCase();
}

export async function ensureWorktree(
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

export async function collectCommitShas(
  worktreePath: string,
  startSha?: string,
  endSha?: string
): Promise<string[]> {
  const start = (startSha ?? "").trim();
  const end = (endSha ?? "").trim();
  if (!start || !end || start === end) return [];
  try {
    const out = await runGit(worktreePath, [
      "rev-list",
      "--reverse",
      `${start}..${end}`,
    ]);
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

export async function getGitHead(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(cwd, ["rev-parse", "HEAD"]);
    const value = out.trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function listConflictFiles(cwd: string): Promise<string[]> {
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

export async function parseCommitSummaries(
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

export async function collectPatchForShas(
  cwd: string,
  shas: string[]
): Promise<string> {
  if (shas.length === 0) return "";
  try {
    return await runGit(cwd, ["show", "--no-color", "--patch", ...shas]);
  } catch {
    return "";
  }
}

export async function autoRebaseWorkerOntoSpace(
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

export async function fetchCloneShas(
  repo: string,
  projectId: string,
  shas: string[]
): Promise<void> {
  if (shas.length === 0) return;
  const remote = cloneRemoteName(projectId);
  await runGitInRepo(repo, ["fetch", remote, ...shas]);
}

export async function branchExists(
  repo: string,
  branchName: string
): Promise<boolean> {
  try {
    await runGitInRepo(repo, [
      "show-ref",
      "--verify",
      `refs/heads/${branchName}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function deleteBranchIfPresent(
  repo: string,
  branchName: string
): Promise<"deleted" | "missing" | "error"> {
  const exists = await branchExists(repo, branchName);
  if (!exists) return "missing";
  try {
    await runGitInRepo(repo, ["branch", "-D", branchName]);
    return "deleted";
  } catch {
    return "error";
  }
}

export async function pushBaseBranch(
  repo: string,
  baseBranch: string
): Promise<{ pushed: boolean; remote?: string }> {
  const remotesRaw = await runGitInRepo(repo, ["remote"]).catch(() => "");
  const remotes = remotesRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (remotes.length === 0) {
    return { pushed: false };
  }

  let remote = remotes.includes("origin") ? "origin" : remotes[0];
  const upstream = await runGitInRepo(repo, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    `${baseBranch}@{upstream}`,
  ]).catch(() => "");
  if (upstream.includes("/")) {
    const [upstreamRemote] = upstream.split("/", 1);
    if (upstreamRemote) remote = upstreamRemote;
  }

  await runGitInRepo(repo, ["push", remote, baseBranch]);
  return { pushed: true, remote };
}

export class SpaceGitAdapter {
  runGit = runGit;
  runGitInRepo = runGitInRepo;
  isGitRepo = isGitRepo;
  ensureWorktree = ensureWorktree;
  collectCommitShas = collectCommitShas;
  getGitHead = getGitHead;
  listConflictFiles = listConflictFiles;
  parseCommitSummaries = parseCommitSummaries;
  collectPatchForShas = collectPatchForShas;
  autoRebaseWorkerOntoSpace = autoRebaseWorkerOntoSpace;
  fetchCloneShas = fetchCloneShas;
  branchExists = branchExists;
  deleteBranchIfPresent = deleteBranchIfPresent;
  pushBaseBranch = pushBaseBranch;
}
