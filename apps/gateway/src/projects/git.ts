import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig } from "@aihub/shared";
import { getProject } from "./store.js";
import { getProjectSpace } from "./space.js";

const execFileAsync = promisify(execFile);

export type FileChange = {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed";
  staged: boolean;
};

export type ProjectChanges = {
  branch: string;
  baseBranch: string;
  source: { type: "space" | "repo"; path: string };
  files: FileChange[];
  diff: string;
  stats: { filesChanged: number; insertions: number; deletions: number };
};

export type CommitResult =
  | { ok: true; sha: string; message: string }
  | { ok: false; error: string };

export type ProjectPullRequestTarget = {
  branch: string;
  baseBranch: string;
  compareUrl?: string;
};

function expandPath(p: string): string {
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

function mapStatus(code: string): FileChange["status"] {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  return "modified";
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trimEnd();
}

function normalizeGithubRepoUrl(remote: string): string | null {
  const value = remote.trim();
  if (!value) return null;
  const cleaned = value.replace(/\.git$/i, "");
  const sshMatch = cleaned.match(/^git@github\.com:(.+\/.+)$/i);
  if (sshMatch?.[1]) return `https://github.com/${sshMatch[1]}`;
  const httpsMatch = cleaned.match(/^https?:\/\/github\.com\/(.+\/.+)$/i);
  if (httpsMatch?.[1]) return `https://github.com/${httpsMatch[1]}`;
  return null;
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

async function resolveRepoPath(
  config: GatewayConfig,
  projectId: string
): Promise<{ repoPath: string; baseBranch: string; source: ProjectChanges["source"] }> {
  const project = await getProject(config, projectId);
  if (!project.ok) throw new Error(project.error);

  const rawRepo =
    typeof project.data.frontmatter.repo === "string"
      ? project.data.frontmatter.repo
      : "";
  if (!rawRepo.trim()) throw new Error("Project repo not set");

  const repo = expandPath(rawRepo.trim());
  const space = await getProjectSpace(config, projectId);
  if (space.ok && (await isGitRepo(space.data.worktreePath))) {
    return {
      repoPath: space.data.worktreePath,
      baseBranch: space.data.baseBranch || "main",
      source: {
        type: "space",
        path: space.data.worktreePath,
      },
    };
  }

  return {
    repoPath: repo,
    baseBranch: "main",
    source: {
      type: "repo",
      path: repo,
    },
  };
}

function parseStatusPorcelain(statusText: string): FileChange[] {
  const files: FileChange[] = [];
  for (const rawLine of statusText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.length < 4) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const filePath = line.slice(3).trim();
    const staged = x !== " " && x !== "?";
    const statusCode = x !== " " && x !== "?" ? x : y;
    files.push({
      path: filePath,
      status: mapStatus(statusCode),
      staged,
    });
  }
  return files;
}

function parseNumStat(text: string): {
  files: Set<string>;
  insertions: number;
  deletions: number;
} {
  const files = new Set<string>();
  let insertions = 0;
  let deletions = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [insRaw, delRaw, ...fileParts] = trimmed.split("\t");
    if (!insRaw || !delRaw || fileParts.length === 0) continue;
    const filePath = fileParts.join("\t");
    files.add(filePath);
    const ins = Number(insRaw);
    const del = Number(delRaw);
    if (Number.isFinite(ins)) insertions += ins;
    if (Number.isFinite(del)) deletions += del;
  }

  return { files, insertions, deletions };
}

export async function getProjectChanges(
  config: GatewayConfig,
  projectId: string
): Promise<ProjectChanges> {
  const resolved = await resolveRepoPath(config, projectId);
  const repo = resolved.repoPath;
  if (!(await isGitRepo(repo))) {
    throw new Error("Not a git repository");
  }

  const [
    branch,
    statusText,
    unstagedDiff,
    stagedDiff,
    unstagedStat,
    stagedStat,
  ] = await Promise.all([
    runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(repo, ["status", "--porcelain"]),
    runGit(repo, ["diff"]),
    runGit(repo, ["diff", "--cached"]),
    runGit(repo, ["diff", "--numstat"]),
    runGit(repo, ["diff", "--cached", "--numstat"]),
  ]);

  const files = parseStatusPorcelain(statusText);
  const diff = [unstagedDiff, stagedDiff].filter(Boolean).join("\n").trim();

  const unstaged = parseNumStat(unstagedStat);
  const staged = parseNumStat(stagedStat);
  const fileSet = new Set<string>([...unstaged.files, ...staged.files]);

  return {
    branch: branch.trim() || "HEAD",
    baseBranch: resolved.baseBranch,
    source: resolved.source,
    files,
    diff,
    stats: {
      filesChanged: fileSet.size,
      insertions: unstaged.insertions + staged.insertions,
      deletions: unstaged.deletions + staged.deletions,
    },
  };
}

export async function commitProjectChanges(
  config: GatewayConfig,
  projectId: string,
  message: string
): Promise<CommitResult> {
  const resolved = await resolveRepoPath(config, projectId);
  const repo = resolved.repoPath;
  if (!(await isGitRepo(repo))) {
    return { ok: false, error: "Not a git repository" };
  }

  const commitMessage = message.trim();
  if (!commitMessage) {
    return { ok: false, error: "Commit message is required" };
  }

  const status = await runGit(repo, ["status", "--porcelain"]);
  if (!status.trim()) {
    return { ok: false, error: "Nothing to commit" };
  }

  await runGit(repo, ["add", "-A"]);
  try {
    await runGit(repo, ["commit", "-m", commitMessage]);
  } catch (error) {
    const msg =
      error instanceof Error && error.message ? error.message : "Commit failed";
    if (msg.includes("nothing to commit")) {
      return { ok: false, error: "Nothing to commit" };
    }
    return { ok: false, error: "Commit failed" };
  }

  const sha = await runGit(repo, ["rev-parse", "--short", "HEAD"]);
  return { ok: true, sha: sha.trim(), message: commitMessage };
}

export async function getProjectPullRequestTarget(
  config: GatewayConfig,
  projectId: string
): Promise<ProjectPullRequestTarget> {
  const resolved = await resolveRepoPath(config, projectId);
  const repo = resolved.repoPath;
  if (!(await isGitRepo(repo))) {
    throw new Error("Not a git repository");
  }

  const branchRaw = await runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRaw.trim() || "HEAD";
  const baseBranch = resolved.baseBranch || "main";

  let compareUrl: string | undefined;
  try {
    const remoteRaw = await runGit(repo, ["remote", "get-url", "origin"]);
    const githubRepo = normalizeGithubRepoUrl(remoteRaw);
    if (githubRepo) {
      compareUrl = `${githubRepo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}?expand=1`;
    }
  } catch {
    // no origin remote configured
  }

  return { branch, baseBranch, compareUrl };
}
