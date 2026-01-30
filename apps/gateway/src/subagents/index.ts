import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig, SubagentGlobalListItem } from "@aihub/shared";
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
  lastError?: string;
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
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

function normalizeLogLine(line: string): SubagentLogEvent | SubagentLogEvent[] {
  const trimmed = line.trimEnd();
  if (!trimmed) {
    return { type: "stdout", text: "" };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topType = typeof parsed.type === "string" ? parsed.type : "";
    if (topType === "system") {
      return { type: "skip" };
    }
    if (topType === "assistant" || topType === "user") {
      const message = parsed.message as Record<string, unknown> | undefined;
      const role = typeof message?.role === "string" ? message.role : topType;
      const content = Array.isArray(message?.content) ? message?.content : [];
      const events: SubagentLogEvent[] = [];
      for (const entry of content) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as Record<string, unknown>;
        const itemType = typeof item.type === "string" ? item.type : "";
        if (itemType === "text" || itemType === "input_text" || itemType === "output_text") {
          const text = typeof item.text === "string" ? item.text : "";
          if (text) {
            events.push({ type: role === "assistant" ? "assistant" : "user", text });
          }
          continue;
        }
        if (itemType === "tool_use") {
          const name = typeof item.name === "string" ? item.name : "";
          const id = typeof item.id === "string" ? item.id : "";
          const input = item.input as Record<string, unknown> | undefined;
          const text = input ? JSON.stringify(input) : "";
          events.push({ type: "tool_call", text, tool: { name, id } });
          continue;
        }
        if (itemType === "tool_result") {
          const toolId = typeof item.tool_use_id === "string" ? item.tool_use_id : "";
          let text = "";
          if (typeof item.content === "string") {
            text = item.content;
          } else if (Array.isArray(item.content)) {
            text = item.content
              .map((block) => {
                if (!block || typeof block !== "object") return "";
                const contentItem = block as Record<string, unknown>;
                return typeof contentItem.text === "string" ? contentItem.text : "";
              })
              .filter(Boolean)
              .join("\n");
          }
          if (text) {
            events.push({ type: "tool_output", text, tool: { id: toolId } });
          }
          continue;
        }
      }
      return events.length > 0 ? events : { type: "skip" };
    }
    if (topType === "result") {
      const text = typeof parsed.result === "string" ? parsed.result : "";
      return text ? { type: "assistant", text } : { type: "skip" };
    }
    if (
      topType === "session_meta" ||
      topType === "turn_context" ||
      topType === "thread.started" ||
      topType === "turn.started" ||
      topType === "turn.completed"
    ) {
      return { type: "skip" };
    }
    if (topType === "item.completed") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item?.type === "agent_message") {
        return { type: "assistant", text: typeof item?.text === "string" ? item.text : "" };
      }
      if (item?.type === "command_execution") {
        const output = typeof item?.aggregated_output === "string" ? item.aggregated_output : "";
        return {
          type: "tool_output",
          text: output,
          tool: { id: typeof item?.id === "string" ? item.id : "" },
        };
      }
      if (item?.type === "error") {
        return { type: "error", text: typeof item?.message === "string" ? item.message : "" };
      }
      return { type: "skip" };
    }
    if (topType === "item.started") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item?.type === "command_execution") {
        const command = typeof item?.command === "string" ? item.command : "";
        const payload = JSON.stringify({ cmd: command });
        return {
          type: "tool_call",
          text: payload,
          tool: {
            name: "exec_command",
            id: typeof item?.id === "string" ? item.id : "",
          },
        };
      }
      return { type: "skip" };
    }
    if (topType === "event_msg") {
      const payload = parsed.payload as Record<string, unknown> | undefined;
      const payloadType = typeof payload?.type === "string" ? payload.type : "";
      if (payloadType === "user_message") {
        return { type: "user", text: typeof payload?.message === "string" ? payload.message : "" };
      }
      if (payloadType === "agent_message") {
        return { type: "assistant", text: typeof payload?.message === "string" ? payload.message : "" };
      }
      return { type: "skip" };
    }
    if (topType === "response_item") {
      const payload = parsed.payload as Record<string, unknown> | undefined;
      const payloadType = typeof payload?.type === "string" ? payload.type : "";
      if (payloadType === "message") {
        const role = typeof payload?.role === "string" ? payload.role : "";
        if (role !== "assistant") return { type: "skip" };
        const content = payload?.content;
        let text = "";
        if (Array.isArray(content)) {
          text = content
            .map((entry) => {
              if (!entry || typeof entry !== "object") return "";
              const item = entry as Record<string, unknown>;
              if (item.type === "output_text" || item.type === "input_text" || item.type === "text") {
                return typeof item.text === "string" ? item.text : "";
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
        }
        return { type: "assistant", text };
      }
      if (payloadType === "function_call") {
        return {
          type: "tool_call",
          text: typeof payload?.arguments === "string" ? payload.arguments : "",
          tool: {
            name: typeof payload?.name === "string" ? payload.name : "",
            id: typeof payload?.call_id === "string" ? payload.call_id : "",
          },
        };
      }
      if (payloadType === "function_call_output") {
        return {
          type: "tool_output",
          text: typeof payload?.output === "string" ? payload.output : "",
          tool: { id: typeof payload?.call_id === "string" ? payload.call_id : "" },
        };
      }
      if (payloadType === "custom_tool_call") {
        return {
          type: "tool_call",
          text: typeof payload?.input === "string" ? payload.input : "",
          tool: {
            name: typeof payload?.name === "string" ? payload.name : "",
            id: typeof payload?.call_id === "string" ? payload.call_id : "",
          },
        };
      }
      if (payloadType === "custom_tool_call_output") {
        return {
          type: "tool_output",
          text: typeof payload?.output === "string" ? payload.output : "",
          tool: { id: typeof payload?.call_id === "string" ? payload.call_id : "" },
        };
      }
      return { type: "skip" };
    }
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
      lastError: state?.last_error,
    });
  }

  return { ok: true, data: { items } };
}

export async function listAllSubagents(
  config: GatewayConfig
): Promise<SubagentGlobalListItem[]> {
  const root = getProjectsRoot(config);
  if (!(await dirExists(root))) return [];

  const projectDirs = await fs.readdir(root, { withFileTypes: true });
  const items: SubagentGlobalListItem[] = [];

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("PRO-")) continue;
    const projectId = entry.name.split("_")[0];
    const workspacesRoot = path.join(root, ".workspaces", projectId);
    if (!(await dirExists(workspacesRoot))) continue;

    const entries = await fs.readdir(workspacesRoot, { withFileTypes: true });
    for (const workspace of entries) {
      if (!workspace.isDirectory()) continue;
      const slug = workspace.name;
      const dir = path.join(workspacesRoot, slug);
      const state = await readJson<{
        supervisor_pid?: number;
        last_error?: string;
        cli?: string;
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
        projectId,
        slug,
        cli: state?.cli,
        status,
        lastActive: progress?.last_active,
      });
    }
  }

  return items;
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
  const events: SubagentLogEvent[] = [];
  for (const line of lines) {
    const normalized = normalizeLogLine(line);
    if (Array.isArray(normalized)) {
      events.push(...normalized);
    } else if (normalized.type !== "skip") {
      events.push(normalized);
    }
  }

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
    return { ok: true, data: { branches: [] } };
  }

  if (!(await pathExists(path.join(repo, ".git")))) {
    return { ok: true, data: { branches: [] } };
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
    return { ok: true, data: { branches: [] } };
  }
}
