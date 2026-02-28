import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig } from "@aihub/shared";
import { getProject } from "./store.js";
import { listSubagents } from "../subagents/index.js";

const execFileAsync = promisify(execFile);

export type FileChange = {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed";
  staged: boolean;
};

export type ProjectChanges = {
  branch: string;
  baseBranch: string;
  files: FileChange[];
  diff: string;
  stats: { filesChanged: number; insertions: number; deletions: number };
};

export type CommitResult =
  | { ok: true; sha: string; message: string }
  | { ok: false; error: string };

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

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  try {
    const status = await runGit(cwd, ["status", "--porcelain"]);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

async function resolveRepoPath(
  config: GatewayConfig,
  projectId: string
): Promise<string> {
  const project = await getProject(config, projectId);
  if (!project.ok) throw new Error(project.error);

  const rawRepo =
    typeof project.data.frontmatter.repo === "string"
      ? project.data.frontmatter.repo
      : "";
  if (!rawRepo.trim()) throw new Error("Project repo not set");

  const repo = expandPath(rawRepo.trim());
  const subagents = await listSubagents(config, projectId, true);
  if (subagents.ok) {
    const candidates = [...subagents.data.items]
      .sort((a, b) => {
        if (a.status === "running" && b.status !== "running") return -1;
        if (b.status === "running" && a.status !== "running") return 1;
        return 0;
      })
      .map((item) => item.worktreePath)
      .filter((item): item is string => Boolean(item && item.trim()))
      .map((item) => item.trim());

    for (const candidate of candidates) {
      const stat = await fs.stat(candidate).catch(() => null);
      if (!stat?.isDirectory()) continue;
      if (!(await isGitRepo(candidate))) continue;
      if (await hasUncommittedChanges(candidate)) {
        return candidate;
      }
    }
  }

  return repo;
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
  const repo = await resolveRepoPath(config, projectId);
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
    baseBranch: "main",
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
  const repo = await resolveRepoPath(config, projectId);
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
