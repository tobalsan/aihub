import { spawn, type ChildProcess } from "node:child_process";
import fsSync from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerRunner, WorkerRunnerHandle, WorkerRunnerStartInput, WorkerRunnerStatus } from "./runner.js";

type ClaudeCommandResponse = {
  id?: string | number | null;
  type?: "response" | string;
  command?: string;
  success?: boolean;
  data?: unknown;
  error?: unknown;
  message?: string;
};

type PendingRequest = {
  resolve: (value: ClaudeCommandResponse) => void;
  reject: (error: Error) => void;
};

type ClaudeSession = {
  key: string;
  child: ChildProcess;
  nextId: number;
  pending: Map<string, PendingRequest>;
  status: WorkerRunnerStatus;
  state?: Record<string, unknown>;
  pendingMessageCount: number;
  active: boolean;
  emit: (type: string, payload: unknown) => void;
  stdoutBuffer: string;
  cleanupTimer?: NodeJS.Timeout;
  retentionTimer?: NodeJS.Timeout;
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandParts(input: WorkerRunnerStartInput): [string, ...string[]] {
  const command = input.workflow.agent.command;
  if (command) {
    const [cmd, ...args] = Array.isArray(command) ? command : [command];
    if (cmd) return [cmd, ...args];
  }
  const shimPath = fileURLToPath(new URL("./claude-rpc-shim.js", import.meta.url));
  const shimArgs = fsSync.existsSync(shimPath)
    ? [shimPath]
    : ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("./claude-rpc-shim.ts", import.meta.url))];
  const args = [...shimArgs, "--name", input.label, "--session-dir", path.join(input.workspace, ".aihub", "claude-sessions"), "--claude-cli", "claude"];
  const model = input.workflow.agent.model ?? input.profile.model;
  if (model) args.push("--model", model);
  return [process.execPath, ...args];
}

export class ClaudeRpcRunner implements WorkerRunner {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private readonly options: { idleCleanupMs?: number; terminalRetentionMs?: number; abortTimeoutMs?: number; requestTimeoutMs?: number } = {}) {}

  async start(input: WorkerRunnerStartInput): Promise<WorkerRunnerHandle> {
    const key = `${input.project.id}:${input.issue.id}:${input.workspace}`;
    const existing = this.sessions.get(key);
    if (existing && this.canReuse(existing)) {
      this.cancelCleanup(existing);
      try {
        await this.continueRun(existing, input);
      } catch (error) {
        this.removeSession(existing, "continue_failed");
        throw error;
      }
      return this.handle(input, existing);
    }

    const session = this.spawnSession(key, input);
    this.sessions.set(key, session);
    try {
      await this.prompt(session, input.prompt);
      await this.refreshState(session).catch((error: Error) => session.emit("worker.claude.state.error", { error: error.message }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.active = false;
      session.status = { status: "error", raw: { message, state: session.state } };
      session.emit("worker.claude.start.error", session.status.raw);
      this.scheduleIdleCleanup(session);
    }
    return this.handle(input, session);
  }

  async status(handle: WorkerRunnerHandle): Promise<WorkerRunnerStatus | undefined> {
    const session = this.sessionFromHandle(handle);
    if (!session) return undefined;
    return session.status;
  }

  async abort(handle: WorkerRunnerHandle): Promise<void> {
    const session = this.sessionFromHandle(handle);
    if (!session || session.status.status !== "running") return;
    const aborted = await Promise.race([
      this.request(session, "abort", {})
        .then(() => true)
        .catch((error: Error) => {
          session.emit("worker.claude.abort.error", { error: error.message });
          return false;
        }),
      sleep(this.options.abortTimeoutMs ?? 5_000).then(() => false),
    ]);
    if (!aborted) session.emit("worker.claude.abort.timeout", { state: session.state });
    if (aborted && session.status.status === "running") {
      session.active = false;
      session.status = { status: "interrupted", raw: { reason: "abort", state: session.state } };
      this.scheduleIdleCleanup(session);
    } else if (session.status.status === "running") {
      session.child.kill("SIGTERM");
      session.status = { status: "interrupted", raw: { reason: "abort", state: session.state } };
    }
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.cancelCleanup(session);
      for (const pending of session.pending.values()) pending.reject(new Error("Claude RPC runner shut down"));
      session.pending.clear();
      if (session.child.exitCode === null && session.child.signalCode === null && !session.child.killed) {
        session.child.stdin?.end();
        session.child.kill("SIGTERM");
      }
      this.sessions.delete(session.key);
      session.emit("worker.claude.session.removed", { state: session.state, reason: "shutdown" });
    }
  }

  private spawnSession(key: string, input: WorkerRunnerStartInput): ClaudeSession {
    const sessionDir = path.join(input.workspace, ".aihub", "claude-sessions");
    fsSync.mkdirSync(sessionDir, { recursive: true });
    const [cmd, ...args] = commandParts(input);
    const child = spawn(cmd, args, {
      cwd: input.workspace,
      env: {
        ...process.env,
        AIHUB_RUN_ID: input.runId,
        AIHUB_PROJECT_ID: input.project.id,
        AIHUB_ISSUE_ID: input.issue.id,
        AIHUB_ISSUE_IDENTIFIER: input.issue.identifier,
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    const session: ClaudeSession = {
      key,
      child,
      nextId: 1,
      pending: new Map(),
      status: { status: "running", raw: { pid: child.pid } },
      pendingMessageCount: 0,
      active: false,
      emit: input.emitEvent ?? (() => undefined),
      stdoutBuffer: "",
    };
    child.once("error", (error) => {
      session.status = { status: "error", raw: { message: error.message, code: (error as NodeJS.ErrnoException).code, state: session.state } };
      session.emit("worker.claude.process.error", session.status.raw);
    });
    child.once("exit", (code, signal) => {
      if (session.status.status === "running") {
        session.status = signal === "SIGTERM" || signal === "SIGINT"
          ? { status: "interrupted", exitCode: code ?? undefined, raw: { code, signal, state: session.state } }
          : code === 0
            ? { status: "done", exitCode: 0, raw: { code, signal, state: session.state } }
            : { status: "error", exitCode: code ?? undefined, raw: { code, signal, state: session.state } };
      }
      for (const pending of session.pending.values()) pending.reject(new Error(`Claude RPC process exited before responding (${signal ?? code ?? "unknown"})`));
      session.pending.clear();
      this.cancelCleanup(session);
      if (this.sessions.get(session.key) === session) this.scheduleRetentionCleanup(session);
      session.emit("worker.claude.process.exit", { status: session.status.status, exitCode: session.status.exitCode, raw: session.status.raw });
    });
    child.stderr?.on("data", (chunk: Buffer) => session.emit("worker.claude.stderr", { text: chunk.toString("utf8") }));
    child.stdout?.on("data", (chunk: Buffer) => this.receiveChunk(session, chunk.toString("utf8")));
    session.emit("worker.claude.started", { pid: child.pid, command: [cmd, ...args] });
    return session;
  }

  private async prompt(session: ClaudeSession, message: string): Promise<void> {
    session.status = { status: "running", raw: { pid: session.child.pid, state: session.state } };
    await this.request(session, "prompt", { message });
    session.active = true;
    session.emit("worker.claude.prompt.accepted", { state: session.state });
  }

  private async continueRun(session: ClaudeSession, input: WorkerRunnerStartInput): Promise<void> {
    const guidance = `Continue the active orchestrator work for ${input.issue.identifier}. Reuse the current Claude session context and continue from the latest state.`;
    if (session.active || session.status.status === "running") {
      await this.request(session, "follow_up", { message: guidance });
      session.emit("worker.claude.continued", { mode: "follow_up", state: session.state });
      return;
    }
    await this.prompt(session, guidance);
    session.emit("worker.claude.continued", { mode: "prompt", state: session.state });
  }

  private async refreshState(session: ClaudeSession): Promise<void> {
    const response = await this.request(session, "get_state", {});
    const state = objectValue(response.data);
    if (state) {
      session.state = state;
      session.status = { ...session.status, raw: { ...(objectValue(session.status.raw) ?? {}), state } };
      session.emit("worker.claude.state", state);
    }
  }

  private request(session: ClaudeSession, type: string, params: Record<string, unknown>): Promise<ClaudeCommandResponse> {
    const id = `req-${session.nextId++}`;
    const payload = JSON.stringify({ id, type, ...params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`Claude RPC ${type} timed out`));
      }, this.options.requestTimeoutMs ?? 30_000);
      session.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      session.child.stdin?.write(`${payload}\n`, (error) => {
        if (!error) return;
        session.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private receiveChunk(session: ClaudeSession, chunk: string): void {
    session.stdoutBuffer += chunk;
    for (;;) {
      const index = session.stdoutBuffer.indexOf("\n");
      if (index === -1) return;
      const line = session.stdoutBuffer.slice(0, index).replace(/\r$/, "");
      session.stdoutBuffer = session.stdoutBuffer.slice(index + 1);
      this.receiveLine(session, line);
    }
  }

  private receiveLine(session: ClaudeSession, line: string): void {
    if (!line.trim()) return;
    let message: ClaudeCommandResponse & Record<string, unknown>;
    try {
      message = JSON.parse(line) as ClaudeCommandResponse & Record<string, unknown>;
    } catch (error) {
      session.emit("worker.claude.protocol.error", { error: error instanceof Error ? error.message : String(error), line });
      return;
    }
    if ((typeof message.id === "string" || typeof message.id === "number") && message.type === "response") {
      const id = String(message.id);
      const pending = session.pending.get(id);
      if (pending) {
        session.pending.delete(id);
        if (message.success === false) pending.reject(new Error(this.responseError(message)));
        else pending.resolve(message);
        return;
      }
    }
    this.handleEvent(session, message);
  }

  private responseError(message: ClaudeCommandResponse): string {
    const error = objectValue(message.error);
    if (typeof error?.message === "string") return error.message;
    if (typeof message.message === "string") return message.message;
    if (typeof message.error === "string") return message.error;
    return `Claude RPC ${message.command ?? "command"} failed`;
  }

  private handleEvent(session: ClaudeSession, event: Record<string, unknown>): void {
    const type = typeof event.type === "string" ? event.type : "unknown";
    if (type === "agent_start" || type === "session_start") {
      this.cancelCleanup(session);
      session.active = true;
      session.status = { status: "running", raw: { ...(objectValue(session.status.raw) ?? {}), state: session.state } };
    } else if (type === "agent_end" || type === "result") {
      session.active = false;
      const subtype = typeof event.subtype === "string" ? event.subtype : undefined;
      const status = typeof event.status === "string" ? event.status : undefined;
      const isError = event.is_error === true || subtype === "error" || status === "error" || status === "failed";
      if (session.status.status === "running") {
        session.status = isError
          ? { status: "error", raw: { event, state: session.state } }
          : session.pendingMessageCount > 0
            ? { status: "running", raw: { event, state: session.state, pendingMessageCount: session.pendingMessageCount } }
            : { status: "done", exitCode: 0, raw: { event, state: session.state } };
      }
      if (session.pendingMessageCount === 0 || isError) this.scheduleIdleCleanup(session);
    } else if (type === "extension_error" || type === "error") {
      session.active = false;
      const error = objectValue(event.error);
      const reason = typeof error?.reason === "string" ? error.reason : typeof event.reason === "string" ? event.reason : undefined;
      session.status = reason === "aborted"
        ? { status: "interrupted", raw: { event, state: session.state } }
        : { status: "error", raw: { event, state: session.state } };
      this.scheduleIdleCleanup(session);
    } else if (type === "queue_update") {
      if (typeof event.pendingMessageCount === "number") session.pendingMessageCount = event.pendingMessageCount;
      session.emit("worker.claude.queue", event);
    }

    if (type === "assistant" || type === "message" || type === "message_start" || type === "message_delta" || type === "message_stop") {
      this.handleMessageEvent(session, event);
      return;
    }
    if (type === "thinking" || type === "thinking_delta") {
      session.emit("worker.claude.thinking", event);
      session.emit(`worker.claude.${type}`, event);
      return;
    }
    if (type === "tool_use" || type === "tool_result" || type.startsWith("tool_")) {
      session.emit("worker.claude.tool", event);
      session.emit(`worker.claude.${type}`, event);
      return;
    }
    if (type === "agent_end" || type === "result") {
      session.emit("worker.claude.result", event);
      session.emit(`worker.claude.${type}`, event);
      return;
    }
    session.emit(`worker.claude.${type}`, event);
  }

  private handleMessageEvent(session: ClaudeSession, event: Record<string, unknown>): void {
    const delta = objectValue(event.delta);
    const contentBlock = objectValue(event.content_block);
    const content = objectValue(event.content);
    const message = objectValue(event.message);
    const messageContent = Array.isArray(message?.content) ? message.content.map(objectValue).filter((value): value is Record<string, unknown> => !!value) : [];
    const nestedTypes = [delta?.type, contentBlock?.type, content?.type, ...messageContent.map((block) => block.type)].filter((value): value is string => typeof value === "string");
    let emitted = false;
    if (nestedTypes.some((type) => type === "thinking" || type === "thinking_delta")) {
      session.emit("worker.claude.thinking", event);
      emitted = true;
    }
    if (nestedTypes.some((type) => type === "tool_use" || type === "tool_result")) {
      session.emit("worker.claude.tool", event);
      emitted = true;
    }
    if (!emitted || nestedTypes.some((type) => type === "text" || type === "text_delta")) {
      session.emit("worker.claude.message", event);
    }
    session.emit(`worker.claude.${String(event.type ?? "message")}`, event);
  }

  private handle(input: WorkerRunnerStartInput, session: ClaudeSession): WorkerRunnerHandle {
    return {
      id: `claude:${input.runId}:${String(session.state?.sessionId ?? session.child.pid ?? "unknown")}`,
      kind: "claude",
      pid: session.child.pid,
      raw: { pid: session.child.pid, state: session.state },
    };
  }

  private sessionFromHandle(handle: WorkerRunnerHandle): ClaudeSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.child.pid === handle.pid) return session;
      const sessionId = session.state?.sessionId;
      if (typeof sessionId === "string" && handle.id.includes(sessionId)) return session;
    }
    return undefined;
  }

  private canReuse(session: ClaudeSession): boolean {
    return session.child.exitCode === null && session.child.signalCode === null && !session.child.killed && (session.status.status === "running" || session.status.status === "done");
  }

  private scheduleIdleCleanup(session: ClaudeSession): void {
    if (session.cleanupTimer) return;
    session.cleanupTimer = setTimeout(() => {
      session.child.stdin?.end();
      if (session.child.exitCode === null && session.child.signalCode === null && !session.child.killed) {
        session.child.kill("SIGTERM");
      } else {
        this.scheduleRetentionCleanup(session);
      }
    }, this.options.idleCleanupMs ?? 30_000);
  }

  private scheduleRetentionCleanup(session: ClaudeSession): void {
    if (session.retentionTimer) return;
    session.retentionTimer = setTimeout(() => {
      this.sessions.delete(session.key);
      session.emit("worker.claude.session.removed", { state: session.state });
    }, this.options.terminalRetentionMs ?? 300_000);
  }

  private cancelCleanup(session: ClaudeSession): void {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    if (session.retentionTimer) clearTimeout(session.retentionTimer);
    session.cleanupTimer = undefined;
    session.retentionTimer = undefined;
  }

  private removeSession(session: ClaudeSession, reason: string): void {
    this.cancelCleanup(session);
    for (const pending of session.pending.values()) pending.reject(new Error(`Claude RPC session removed: ${reason}`));
    session.pending.clear();
    if (session.child.exitCode === null && session.child.signalCode === null && !session.child.killed) {
      session.child.stdin?.end();
      session.child.kill("SIGTERM");
    }
    this.sessions.delete(session.key);
    session.emit("worker.claude.session.removed", { state: session.state, reason });
  }
}
