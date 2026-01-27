import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig } from "@aihub/shared";
import { parseMarkdownFile } from "../taskboard/parser.js";

export type SubagentStatus = "running" | "replied" | "error" | "idle";

export type SubagentListItem = {
  slug: string;
  cli?: string;
  runMode?: string;
  status: SubagentStatus;
  lastActive?: string;
  baseBranch?: string;
  worktreePath?: string;
};

export type SubagentLogEvent = {
  ts?: string;
  type: string;
  text?: string;
  tool?: { name?: string; id?: string };
  diff?: { path?: string; summary?: string };
};

export type SubagentListResult =
  | { ok: true; data: { items: SubagentListItem[] } }
  | { ok: false; error: string };

export type SubagentLogsResult =
  | { ok: true; data: { cursor: number; events: SubagentLogEvent[] } }
  | { ok: false; error: string };

export type ProjectBranchesResult =
  | { ok: true; data: { branches: string[] } }
  | { ok: false; error: string };

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

function getProjectsRoot(config: GatewayConfig): string {
  const root = config.projects?.root ?? "~/projects";
  return expandPath(root);
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findProjectDir(root: string, id: string): Promise<string | null> {
  if (!(await dirExists(root))) return null;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === id || entry.name.startsWith(`${id}_`)) {
      return entry.name;
    }
  }
  return null;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number | undefined | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLastOutcome(historyPath: string): Promise<"replied" | "error" | null> {
  try {
    const raw = await fs.readFile(historyPath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      try {
        const ev = JSON.parse(line) as { type?: string; data?: { outcome?: string } };
        if (ev.type === "worker.finished") {
          if (ev.data?.outcome === "replied") return "replied";
          if (ev.data?.outcome === "error") return "error";
        }
      } catch {
        // ignore parse errors
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeLogLine(line: string): SubagentLogEvent {
  const trimmed = line.trimEnd();
  if (!trimmed) {
    return { type: "stdout", text: "" };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const text =
      typeof parsed.text === "string"
        ? parsed.text
        : typeof parsed.content === "string"
          ? parsed.content
          : typeof parsed.message === "string"
            ? parsed.message
            : undefined;
    const parsedType = typeof parsed.type === "string" ? parsed.type : undefined;

    if (parsedType && ["stdout", "stderr", "tool_call", "tool_output", "diff", "message", "error", "session"].includes(parsedType)) {
      return {
        ts: typeof parsed.ts === "string" ? parsed.ts : undefined,
        type: parsedType,
        text: text ?? trimmed,
      };
    }
  } catch {
    // fall through to raw
  }

  return { type: "stdout", text: trimmed };
}

export async function listSubagents(
  config: GatewayConfig,
  projectId: string
): Promise<SubagentListResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const workspacesRoot = path.join(root, ".workspaces", projectId);
  if (!(await dirExists(workspacesRoot))) {
    return { ok: true, data: { items: [] } };
  }

  const entries = await fs.readdir(workspacesRoot, { withFileTypes: true });
  const items: SubagentListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const dir = path.join(workspacesRoot, slug);
    const state = await readJson<{
      supervisor_pid?: number;
      last_error?: string;
      cli?: string;
      run_mode?: string;
      worktree_path?: string;
      base_branch?: string;
    }>(path.join(dir, "state.json"));
    const progress = await readJson<{ last_active?: string }>(path.join(dir, "progress.json"));
    const outcome = await readLastOutcome(path.join(dir, "history.jsonl"));

    let status: SubagentStatus = "idle";
    if (state?.last_error && state.last_error.trim()) {
      status = "error";
    } else if (isProcessAlive(state?.supervisor_pid)) {
      status = "running";
    } else if (outcome === "error") {
      status = "error";
    } else if (outcome === "replied") {
      status = "replied";
    }

    items.push({
      slug,
      cli: state?.cli,
      runMode: state?.run_mode,
      status,
      lastActive: progress?.last_active,
      baseBranch: state?.base_branch,
      worktreePath: state?.worktree_path,
    });
  }

  return { ok: true, data: { items } };
}

export async function getSubagentLogs(
  config: GatewayConfig,
  projectId: string,
  slug: string,
  since: number
): Promise<SubagentLogsResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const logsPath = path.join(root, ".workspaces", projectId, slug, "logs.jsonl");
  let stat;
  try {
    stat = await fs.stat(logsPath);
  } catch {
    return { ok: true, data: { cursor: 0, events: [] } };
  }

  const size = stat.size;
  if (since >= size) {
    return { ok: true, data: { cursor: size, events: [] } };
  }

  const buffer = await fs.readFile(logsPath);
  const slice = buffer.subarray(Math.max(0, since));
  const text = slice.toString("utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const events = lines.map((line) => normalizeLogLine(line));

  return { ok: true, data: { cursor: size, events } };
}

export async function listProjectBranches(
  config: GatewayConfig,
  projectId: string
): Promise<ProjectBranchesResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const readmePath = path.join(root, dirName, "README.md");
  const { frontmatter } = await parseMarkdownFile(readmePath);
  const repo = typeof frontmatter.repo === "string" ? expandPath(frontmatter.repo) : "";
  if (!repo) {
    return { ok: false, error: "Project repo not set" };
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", ["-C", repo, "branch", "--format=%(refname:short)"]);
    const branches = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { ok: true, data: { branches } };
  } catch {
    return { ok: false, error: "Failed to list branches" };
  }
}
