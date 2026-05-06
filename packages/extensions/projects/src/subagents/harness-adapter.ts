import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import os from "node:os";
import { spawn } from "node:child_process";
import type { SubagentCli } from "./runner.js";

export type SubagentHarnessCommand = {
  command: string;
  args: string[];
};

export type SubagentHarnessArgsInput = {
  prompt: string;
  sessionId?: string;
  sessionFile?: string;
  model?: string;
  reasoningEffort?: string;
  thinking?: string;
};

export interface SubagentHarnessAdapter {
  readonly cli: SubagentCli;
  buildArgs(input: SubagentHarnessArgsInput): string[];
  resolveCommand(args: string[]): Promise<SubagentHarnessCommand>;
  extractSessionId(line: string): string | undefined;
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
  const child = spawn(shell, ["-l", "-c", `type ${execName} >/dev/null 2>&1`], {
    stdio: "ignore",
  });
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function resolveViaShell(
  execName: string,
  args: string[]
): Promise<SubagentHarnessCommand | null> {
  if (!isSafeShellWord(execName)) return null;
  if (!(await canFindViaShell(execName))) return null;
  const shell = await resolveShell();
  if (!shell) return null;
  return {
    command: shell,
    args: ["-l", "-c", `${execName} "$@"`, "--", ...args],
  };
}

function commonCandidatePaths(execName: string): string[] {
  const home = homedir();
  const candidates: string[] = [];
  const nodeDir = path.dirname(process.execPath);
  if (nodeDir && nodeDir !== ".") candidates.push(path.join(nodeDir, execName));

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
        candidates.push(
          path.join(home, ".local", "bin", "codex"),
          path.join(home, ".cargo", "bin", "codex")
        );
        break;
      case "pi":
        candidates.push(path.join(home, ".local", "bin", "pi"));
        break;
    }
    candidates.push(
      path.join(home, ".local", "bin", execName),
      path.join(home, "bin", execName),
      path.join(home, ".cargo", "bin", execName)
    );
  }

  if (os.platform() === "darwin") {
    candidates.push(
      path.join("/opt", "homebrew", "bin", execName),
      path.join("/usr", "local", "bin", execName)
    );
  } else {
    candidates.push(path.join("/usr", "local", "bin", execName));
  }

  return Array.from(new Set(candidates));
}

async function resolveCliCommand(
  execName: string,
  args: string[]
): Promise<SubagentHarnessCommand> {
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

function parseSessionLine<T extends Record<string, unknown>>(
  line: string
): T | undefined {
  try {
    return JSON.parse(line) as T;
  } catch {
    return undefined;
  }
}

class ClaudeHarnessAdapter implements SubagentHarnessAdapter {
  readonly cli = "claude" as const;

  buildArgs(input: SubagentHarnessArgsInput): string[] {
    const args = [
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];
    if (input.model) args.push("--model", input.model);
    if (input.reasoningEffort) args.push("--effort", input.reasoningEffort);
    return input.sessionId ? ["-r", input.sessionId, ...args] : args;
  }

  resolveCommand(args: string[]): Promise<SubagentHarnessCommand> {
    return resolveCliCommand(this.cli, args);
  }

  extractSessionId(line: string): string | undefined {
    const ev = parseSessionLine<{ type?: string; session_id?: string }>(line);
    return ev?.type === "system" ? ev.session_id : undefined;
  }
}

class CodexHarnessAdapter implements SubagentHarnessAdapter {
  readonly cli = "codex" as const;

  buildArgs(input: SubagentHarnessArgsInput): string[] {
    const base = [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
    ];
    if (input.model) base.push("-m", input.model);
    if (input.reasoningEffort) {
      base.push("-c", `reasoning_effort=${input.reasoningEffort}`);
    }
    if (input.sessionId)
      return [...base, "resume", input.sessionId, input.prompt];
    return [...base, input.prompt];
  }

  resolveCommand(args: string[]): Promise<SubagentHarnessCommand> {
    return resolveCliCommand(this.cli, args);
  }

  extractSessionId(line: string): string | undefined {
    const ev = parseSessionLine<{ type?: string; thread_id?: string }>(line);
    return ev?.type === "thread.started" ? ev.thread_id : undefined;
  }
}

class PiHarnessAdapter implements SubagentHarnessAdapter {
  readonly cli = "pi" as const;

  buildArgs(input: SubagentHarnessArgsInput): string[] {
    if (!input.sessionFile) throw new Error("Missing Pi session file path");
    const args = ["--mode", "json", "--session", input.sessionFile];
    if (input.model) args.push("--model", input.model);
    if (input.thinking) args.push("--thinking", input.thinking);
    args.push(input.prompt);
    return args;
  }

  resolveCommand(args: string[]): Promise<SubagentHarnessCommand> {
    return resolveCliCommand(this.cli, args);
  }

  extractSessionId(line: string): string | undefined {
    const ev = parseSessionLine<{ type?: string; id?: string }>(line);
    return ev?.type === "session" ? ev.id : undefined;
  }
}

export function getSubagentHarnessAdapter(
  cli: SubagentCli
): SubagentHarnessAdapter {
  switch (cli) {
    case "claude":
      return new ClaudeHarnessAdapter();
    case "codex":
      return new CodexHarnessAdapter();
    case "pi":
      return new PiHarnessAdapter();
  }
}
