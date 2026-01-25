import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import os from "node:os";
import { spawn } from "node:child_process";
import type { GatewayConfig } from "@aihub/shared";
import { parseMarkdownFile } from "../taskboard/parser.js";

export type SubagentCli = "claude" | "codex" | "droid" | "gemini";
export type SubagentMode = "main-run" | "worktree";

export type SpawnSubagentInput = {
  projectId: string;
  slug: string;
  cli: SubagentCli;
  prompt: string;
  mode?: SubagentMode;
  baseBranch?: string;
  resume?: boolean;
};

export type SpawnSubagentResult =
  | { ok: true; data: { slug: string } }
  | { ok: false; error: string };

export type InterruptSubagentResult =
  | { ok: true; data: { slug: string } }
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

function buildProjectSummary(title: string, status: string, content: string): string {
  const lines = [
    "Let's tackle the following project:",
    "",
    title,
    status,
    content,
  ];
  return lines.join("\n").trimEnd();
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

async function appendHistory(historyPath: string, event: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  await fs.appendFile(historyPath, line, "utf8");
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function isExecutableFile(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then((st) => {
      if (st.isDirectory()) return false;
      if (os.platform() === "win32") return true;
      return (st.mode & 0o111) !== 0;
    })
    .catch(() => false);
}

async function resolveFromPath(execName: string): Promise<string | null> {
  const envPath = process.env.PATH ?? "";
  const parts = envPath.split(path.delimiter).filter((p) => p);
  for (const part of parts) {
    const candidate = path.join(part, execName);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function isSafeShellWord(value: string): boolean {
  if (!value) return false;
  if (/[\\/\s]/.test(value)) return false;
  return /^[a-zA-Z0-9._+-]+$/.test(value);
}

async function resolveShell(): Promise<string | null> {
  const shell = process.env.SHELL;
  if (shell && (await isExecutableFile(shell))) return shell;
  for (const candidate of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

async function canFindViaShell(execName: string): Promise<boolean> {
  const shell = await resolveShell();
  if (!shell) return false;
  const child = spawn(shell, ["-l", "-i", "-c", `type ${execName} >/dev/null 2>&1`], {
    stdio: "ignore",
  });
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function resolveViaShell(execName: string, args: string[]): Promise<{ command: string; args: string[] } | null> {
  if (!isSafeShellWord(execName)) return null;
  if (!(await canFindViaShell(execName))) return null;
  const shell = await resolveShell();
  if (!shell) return null;
  const shellArgs = ["-l", "-i", "-c", `${execName} \"$@\"`, "--", ...args];
  return { command: shell, args: shellArgs };
}

function commonCandidatePaths(execName: string): string[] {
  const home = homedir();
  const candidates: string[] = [];

  if (home) {
    switch (execName) {
      case "claude":
        candidates.push(
          path.join(home, ".claude", "local", "claude"),
          path.join(home, ".claude", "local", "bin", "claude"),
          path.join(home, ".local", "bin", "claude")
        );
        break;
      case "codex":
        candidates.push(path.join(home, ".local", "bin", "codex"), path.join(home, ".cargo", "bin", "codex"));
        break;
      case "gemini":
        candidates.push(path.join(home, ".local", "bin", "gemini"));
        break;
      case "droid":
        candidates.push(path.join(home, ".local", "bin", "droid"));
        break;
    }

    candidates.push(
      path.join(home, ".local", "bin", execName),
      path.join(home, "bin", execName),
      path.join(home, ".cargo", "bin", execName)
    );
  }

  if (os.platform() === "darwin") {
    candidates.push(path.join("/opt", "homebrew", "bin", execName), path.join("/usr", "local", "bin", execName));
  } else {
    candidates.push(path.join("/usr", "local", "bin", execName));
  }

  return Array.from(new Set(candidates));
}

async function resolveCliCommand(execName: string, args: string[]): Promise<{ command: string; args: string[] }> {
  if (execName.includes("/") || execName.includes("\\")) {
    if (await isExecutableFile(execName)) return { command: execName, args };
  }

  const fromPath = await resolveFromPath(execName);
  if (fromPath) return { command: fromPath, args };

  for (const candidate of commonCandidatePaths(execName)) {
    if (await isExecutableFile(candidate)) return { command: candidate, args };
  }

  const shell = await resolveViaShell(execName, args);
  if (shell) return shell;

  throw new Error(`${execName} not found`);
}

function buildArgs(cli: SubagentCli, prompt: string, sessionId: string | undefined): string[] {
  switch (cli) {
    case "claude": {
      const args = ["-p", prompt, "--output-format", "stream-json"];
      if (sessionId) return ["-r", sessionId, ...args];
      return args;
    }
    case "droid": {
      const args = ["exec", prompt, "--output-format", "stream-json"];
      if (sessionId) return ["exec", "--session-id", sessionId, prompt, "--output-format", "stream-json"];
      return args;
    }
    case "gemini": {
      if (sessionId) return ["--resume", sessionId, "--prompt", prompt];
      return ["-p", prompt, "--output-format", "stream-json"];
    }
    case "codex": {
      if (sessionId) return ["exec", "--json", "resume", sessionId, prompt];
      return ["exec", "--json", prompt];
    }
  }
}

async function createWorktree(
  repo: string,
  worktreePath: string,
  branch: string,
  baseBranch: string
): Promise<void> {
  await fs.mkdir(worktreePath, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["-C", repo, "worktree", "add", "-b", branch, worktreePath, baseBranch], {
      stdio: "ignore",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("git worktree add failed"));
    });
    child.on("error", reject);
  });
}

export async function spawnSubagent(
  config: GatewayConfig,
  input: SpawnSubagentInput
): Promise<SpawnSubagentResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, input.projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${input.projectId}` };
  }

  const readmePath = path.join(root, dirName, "README.md");
  const { frontmatter, title, content } = await parseMarkdownFile(readmePath);
  const repo = typeof frontmatter.repo === "string" ? frontmatter.repo : "";
  if (!repo) {
    return { ok: false, error: "Project repo not set" };
  }

  const resolvedTitle = typeof frontmatter.title === "string" ? frontmatter.title : title ?? "";
  const status = typeof frontmatter.status === "string" ? frontmatter.status : "";
  const summary = buildProjectSummary(resolvedTitle, status, content ?? "");

  const mode: SubagentMode = input.mode ?? "worktree";
  const workspacesRoot = path.join(root, ".workspaces", input.projectId);
  const workspaceDir = path.join(workspacesRoot, input.slug);

  if (await dirExists(workspaceDir)) {
    if (!input.resume) {
      return { ok: false, error: `Subagent already exists: ${input.slug}` };
    }
  } else {
    await fs.mkdir(workspaceDir, { recursive: true });
  }

  let worktreePath = repo;
  let baseBranch = input.baseBranch ?? "main";
  if (mode === "worktree") {
    const branch = `${input.projectId}/${input.slug}`;
    worktreePath = workspaceDir;
    if (!(await dirExists(path.join(worktreePath, ".git")))) {
      await createWorktree(repo, worktreePath, branch, baseBranch);
    }
  }

  const statePath = path.join(workspaceDir, "state.json");
  const historyPath = path.join(workspaceDir, "history.jsonl");
  const progressPath = path.join(workspaceDir, "progress.json");
  const logsPath = path.join(workspaceDir, "logs.jsonl");

  let existingSessionId: string | undefined;
  if (input.resume) {
    try {
      const raw = await fs.readFile(statePath, "utf8");
      const state = JSON.parse(raw) as { session_id?: string };
      if (state.session_id) existingSessionId = state.session_id;
    } catch {
      // ignore
    }
  }

  const prompt = summary ? `${summary}\n\n${input.prompt}` : input.prompt;
  const args = buildArgs(input.cli, prompt, existingSessionId);
  let resolved;
  try {
    resolved = await resolveCliCommand(input.cli, args);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "CLI not found" };
  }
  const child = spawn(resolved.command, resolved.args, { cwd: worktreePath, stdio: ["ignore", "pipe", "ignore"] });

  const startedAt = new Date().toISOString();
  const state = {
    session_id: existingSessionId ?? "",
    supervisor_pid: child.pid ?? 0,
    started_at: startedAt,
    last_error: "",
    cli: input.cli,
    run_mode: mode,
    worktree_path: worktreePath,
    base_branch: baseBranch,
  };

  await writeJson(statePath, state);
  await writeJson(progressPath, { last_active: startedAt, tool_calls: 0 });
  await fs.appendFile(logsPath, "", "utf8");
  await appendHistory(historyPath, {
    ts: startedAt,
    type: "worker.started",
    data: {
      action: input.resume ? "follow_up" : "started",
      harness: input.cli,
      session_id: existingSessionId ?? "",
    },
  });

  child.stdout?.on("data", async (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    await fs.appendFile(logsPath, text, "utf8");
    await writeJson(progressPath, { last_active: new Date().toISOString(), tool_calls: 0 });

    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      if (input.cli === "codex") {
        try {
          const ev = JSON.parse(line) as { type?: string; thread_id?: string };
          if (ev.type === "thread.started" && ev.thread_id) {
            const next = { ...state, session_id: ev.thread_id };
            await writeJson(statePath, next);
          }
        } catch {
          // ignore
        }
      }
    }
  });

  child.on("exit", async (code) => {
    const finishedAt = new Date().toISOString();
    const outcome = code === 0 ? "replied" : "error";
    const data: Record<string, unknown> = {
      run_id: `${Date.now()}`,
      duration_ms: 0,
      tool_calls: 0,
      outcome,
    };
    if (outcome === "error") {
      data.error_message = "process exited";
    }
    await appendHistory(historyPath, {
      ts: finishedAt,
      type: "worker.finished",
      data,
    });
    if (outcome === "error") {
      try {
        const raw = await fs.readFile(statePath, "utf8");
        const current = JSON.parse(raw) as Record<string, unknown>;
        current.last_error = "process exited";
        await writeJson(statePath, current);
      } catch {
        // ignore
      }
    }
  });

  child.on("error", async () => {
    const finishedAt = new Date().toISOString();
    await appendHistory(historyPath, {
      ts: finishedAt,
      type: "worker.finished",
      data: { run_id: `${Date.now()}`, outcome: "error", error_message: "spawn failed" },
    });
  });

  return { ok: true, data: { slug: input.slug } };
}

export async function interruptSubagent(
  config: GatewayConfig,
  projectId: string,
  slug: string
): Promise<InterruptSubagentResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const workspaceDir = path.join(root, ".workspaces", projectId, slug);
  const statePath = path.join(workspaceDir, "state.json");
  const historyPath = path.join(workspaceDir, "history.jsonl");

  try {
    const raw = await fs.readFile(statePath, "utf8");
    const state = JSON.parse(raw) as { supervisor_pid?: number };
    if (state.supervisor_pid) {
      process.kill(state.supervisor_pid, "SIGTERM");
      await appendHistory(historyPath, {
        ts: new Date().toISOString(),
        type: "worker.interrupt",
        data: { action: "requested", signal: "SIGTERM", supervisor_pid: state.supervisor_pid },
      });
      return { ok: true, data: { slug } };
    }
  } catch {
    // ignore
  }

  return { ok: false, error: `Subagent not running: ${slug}` };
}
