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

export type KillSubagentResult =
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

function buildProjectSummary(title: string, status: string, projectPath: string, content: string): string {
  const lines = [
    "Let's tackle the following project:",
    "",
    title,
    status,
    `Project folder: ${projectPath}`,
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
  const shellArgs = ["-l", "-i", "-c", `${execName} "$@"`, "--", ...args];
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
      const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
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
      const base = ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox"];
      if (sessionId) return [...base, "resume", sessionId, prompt];
      return [...base, prompt];
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

  const projectDir = path.join(root, dirName);
  const readmePath = path.join(projectDir, "README.md");
  const { frontmatter, title, content } = await parseMarkdownFile(readmePath);
  let threadContent = "";
  try {
    const parsedThread = await parseMarkdownFile(path.join(projectDir, "THREAD.md"));
    threadContent = parsedThread.content.trim();
  } catch {
    // ignore missing thread
  }
  const repoValue = typeof frontmatter.repo === "string" ? expandPath(frontmatter.repo) : "";
  const repo = repoValue && (await dirExists(repoValue)) ? repoValue : "";

  // Validate mandatory parameters
  if (!input.mode) {
    return { ok: false, error: "mode is required (must be 'worktree' or 'main-run')" };
  }
  if (!repo) {
    return { ok: false, error: "Project repo not set in frontmatter" };
  }

  // Gather content from all markdown files
  const entries = await fs.readdir(projectDir, { withFileTypes: true });
  const mdFiles = entries
    .filter(e => e.isFile() && e.name.endsWith(".md") && e.name !== "THREAD.md")
    .map(e => e.name)
    .sort((a, b) => {
      if (a.toUpperCase() === "README.MD") return -1;
      if (b.toUpperCase() === "README.MD") return 1;
      return a.localeCompare(b);
    });

  let fullContent = content ?? "";
  if (threadContent) {
    fullContent += `\n\n## THREAD\n\n${threadContent}`;
  }
  for (const file of mdFiles) {
    if (file.toUpperCase() === "README.MD") continue;
    try {
      const parsed = await parseMarkdownFile(path.join(projectDir, file));
      if (parsed.content) {
        const label = file.replace(/\.md$/i, "");
        fullContent += `\n\n## ${label}\n\n${parsed.content}`;
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  const resolvedTitle = typeof frontmatter.title === "string" ? frontmatter.title : title ?? "";
  const status = typeof frontmatter.status === "string" ? frontmatter.status : "";
  const summary = buildProjectSummary(resolvedTitle, status, projectDir, fullContent);

  const mode: SubagentMode = input.mode;
  const repoHasGit = await fs
    .stat(path.join(repo, ".git"))
    .then(() => true)
    .catch(() => false);
  if (mode === "worktree" && !repoHasGit) {
    return { ok: false, error: "Project repo is not a git repo" };
  }
  const workspacesRoot = path.join(root, ".workspaces", input.projectId);
  const workspaceDir = path.join(workspacesRoot, input.slug);

  if (await dirExists(workspaceDir)) {
    if (!input.resume) {
      return { ok: false, error: `Subagent already exists: ${input.slug}` };
    }
  } else {
    await fs.mkdir(workspaceDir, { recursive: true });
  }

  let worktreePath = repo || workspaceDir;
  const baseBranch = input.baseBranch ?? "main";
  if (mode === "worktree") {
    const branch = `${input.projectId}/${input.slug}`;
    worktreePath = workspaceDir;
    const worktreeGitExists = await fs
      .stat(path.join(worktreePath, ".git"))
      .then(() => true)
      .catch(() => false);
    if (!worktreeGitExists) {
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

  let prompt = summary ? `${summary}\n\n${input.prompt}` : input.prompt;
  if (mode === "worktree") {
    const worktreeLine = `Worktree path: ${worktreePath}`;
    if (prompt.includes("Repo path:")) {
      prompt = prompt.replace(/\n\nRepo path:[^\n]*(\n|$)/, `\n\n${worktreeLine}\n`);
    } else {
      prompt = `${prompt}\n\n${worktreeLine}`;
    }
    prompt = prompt.trimEnd();
  }
  const args = buildArgs(input.cli, prompt, existingSessionId);
  let resolved;
  try {
    resolved = await resolveCliCommand(input.cli, args);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "CLI not found" };
  }
  const child = spawn(resolved.command, resolved.args, { cwd: worktreePath, stdio: ["ignore", "pipe", "pipe"] });

  child.on("error", async () => {
    const finishedAt = new Date().toISOString();
    await appendHistory(historyPath, {
      ts: finishedAt,
      type: "worker.finished",
      data: { run_id: `${Date.now()}`, outcome: "error", error_message: "spawn failed" },
    });
  });

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
  if (input.prompt.trim().length > 0) {
    const userLine = JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: input.prompt },
    });
    await fs.appendFile(logsPath, `${userLine}\n`, "utf8");
  }
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
      if (input.cli === "claude") {
        try {
          const ev = JSON.parse(line) as { type?: string; session_id?: string };
          if (ev.type === "system" && ev.session_id) {
            const next = { ...state, session_id: ev.session_id };
            await writeJson(statePath, next);
          }
        } catch {
          // ignore
        }
      }
    }
  });

  child.stderr?.on("data", async (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return;
    const stamped = lines
      .map((line) => JSON.stringify({ type: "stderr", text: line }))
      .join("\n");
    await fs.appendFile(logsPath, `${stamped}\n`, "utf8");
    await writeJson(progressPath, { last_active: new Date().toISOString(), tool_calls: 0 });
  });

  child.on("exit", async (code, signal) => {
    const finishedAt = new Date().toISOString();
    const outcome = code === 0 ? "replied" : "error";
    const exitMessage =
      code !== null && code !== 0
        ? `process exited (code ${code})`
        : signal
          ? `process exited (signal ${signal})`
          : "process exited";
    const data: Record<string, unknown> = {
      run_id: `${Date.now()}`,
      duration_ms: 0,
      tool_calls: 0,
      outcome,
    };
    if (outcome === "error") {
      data.error_message = exitMessage;
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
        current.last_error = exitMessage;
        await writeJson(statePath, current);
      } catch {
        // ignore
      }
    }
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

export async function killSubagent(
  config: GatewayConfig,
  projectId: string,
  slug: string
): Promise<KillSubagentResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const workspaceDir = path.join(root, ".workspaces", projectId, slug);
  if (!(await dirExists(workspaceDir))) {
    return { ok: false, error: `Subagent not found: ${slug}` };
  }

  const statePath = path.join(workspaceDir, "state.json");
  let state: { supervisor_pid?: number; run_mode?: string; worktree_path?: string } | null = null;
  try {
    const raw = await fs.readFile(statePath, "utf8");
    state = JSON.parse(raw) as { supervisor_pid?: number; run_mode?: string; worktree_path?: string };
  } catch {
    state = null;
  }

  if (state?.supervisor_pid) {
    try {
      process.kill(state.supervisor_pid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch {
      // ignore
    }
  }

  const workspacesRoot = path.join(root, ".workspaces", projectId);
  const worktreePath = typeof state?.worktree_path === "string" ? state.worktree_path : "";
  let runMode = typeof state?.run_mode === "string" ? state.run_mode : "";
  if (!runMode) {
    const workspaceHasGit = await fs
      .stat(path.join(workspaceDir, ".git"))
      .then(() => true)
      .catch(() => false);
    const worktreeHasGit = worktreePath
      ? await fs
          .stat(path.join(worktreePath, ".git"))
          .then(() => true)
          .catch(() => false)
      : false;
    if (
      worktreePath &&
      path.resolve(worktreePath).startsWith(path.resolve(workspacesRoot)) &&
      (await dirExists(worktreePath)) &&
      worktreeHasGit
    ) {
      runMode = "worktree";
    } else if (workspaceHasGit) {
      runMode = "worktree";
    }
  }
  if (!runMode) runMode = "main-run";

  if (runMode === "worktree") {
    const readmePath = path.join(root, dirName, "README.md");
    const { frontmatter } = await parseMarkdownFile(readmePath);
    const repoValue = typeof frontmatter.repo === "string" ? expandPath(frontmatter.repo) : "";
    const repo = repoValue && (await dirExists(repoValue)) ? repoValue : "";
    if (!repo) {
      return { ok: false, error: "Project repo not set" };
    }

    const resolvedWorktreePath = worktreePath || workspaceDir;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("git", ["-C", repo, "worktree", "remove", resolvedWorktreePath, "--force"], {
          stdio: "ignore",
        });
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error("git worktree remove failed"));
        });
        child.on("error", reject);
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "git worktree remove failed" };
    }

    try {
      await new Promise<void>((resolve) => {
        const child = spawn("git", ["-C", repo, "branch", "-D", `${projectId}/${slug}`], {
          stdio: "ignore",
        });
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else resolve();
        });
        child.on("error", () => resolve());
      });
    } catch {
      // ignore
    }
  }

  await fs.rm(workspaceDir, { recursive: true, force: true });

  // Remove parent folder (PRO-XX) if empty
  try {
    const remaining = await fs.readdir(workspacesRoot);
    if (remaining.length === 0) {
      await fs.rmdir(workspacesRoot);
    }
  } catch {
    // ignore - folder may not exist or already removed
  }

  return { ok: true, data: { slug } };
}
