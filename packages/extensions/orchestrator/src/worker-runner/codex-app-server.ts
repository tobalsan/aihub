import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { WorkerRunner, WorkerRunnerHandle, WorkerRunnerStartInput, WorkerRunnerStatus } from "./runner.js";

type JsonRpcMessage = {
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type CodexSession = {
  key: string;
  child: ChildProcess;
  nextId: number;
  pending: Map<string | number, PendingRequest>;
  status: WorkerRunnerStatus;
  threadId?: string;
  turnId?: string;
  activeTurn: boolean;
  initialized: Promise<void>;
  emit: (type: string, payload: unknown) => void;
  cleanupTimer?: NodeJS.Timeout;
  retentionTimer?: NodeJS.Timeout;
};

function commandParts(command: string | string[] | undefined): [string, ...string[]] {
  if (!command) throw new Error("agent.command is required for codex runner");
  const [cmd, ...args] = Array.isArray(command) ? command : [command];
  if (!cmd) throw new Error("agent.command is required for codex runner");
  return [cmd, ...args];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textFromInput(input: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: input }];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CodexAppServerRunner implements WorkerRunner {
  private readonly sessions = new Map<string, CodexSession>();

  constructor(private readonly options: { idleCleanupMs?: number; terminalRetentionMs?: number; interruptTimeoutMs?: number } = {}) {}

  async start(input: WorkerRunnerStartInput): Promise<WorkerRunnerHandle> {
    const key = `${input.project.id}:${input.issue.id}:${input.workspace}`;
    const existing = this.sessions.get(key);
    if (existing && this.canReuse(existing)) {
      this.cancelCleanup(existing);
      await this.continueTurn(existing, input);
      return this.handle(input, existing);
    }

    const session = this.spawnSession(key, input);
    this.sessions.set(key, session);
    await session.initialized;
    const thread = await this.request(session, "thread/start", {
      model: input.workflow.agent.model ?? input.profile.model,
      serviceName: "aihub-orchestrator",
    });
    session.threadId = this.extractThreadId(thread);
    session.emit("worker.codex.thread.started", { threadId: session.threadId, raw: thread });
    await this.startTurn(session, input.prompt, input);
    return this.handle(input, session);
  }

  async status(handle: WorkerRunnerHandle): Promise<WorkerRunnerStatus | undefined> {
    const session = this.sessionFromHandle(handle);
    return session?.status;
  }

  async abort(handle: WorkerRunnerHandle): Promise<void> {
    const session = this.sessionFromHandle(handle);
    if (!session || session.status.status !== "running") return;
    if (session.threadId && session.turnId && session.activeTurn) {
      const interrupted = await Promise.race([
        this.request(session, "turn/interrupt", { threadId: session.threadId, turnId: session.turnId })
          .then(() => true)
          .catch((error: Error) => {
            session.emit("worker.codex.interrupt.error", { error: error.message });
            return false;
          }),
        sleep(this.options.interruptTimeoutMs ?? 5_000).then(() => false),
      ]);
      if (!interrupted) session.emit("worker.codex.interrupt.timeout", { threadId: session.threadId, turnId: session.turnId });
    }
    if (session.status.status === "running") {
      session.child.kill("SIGTERM");
      session.status = { status: "interrupted", raw: { reason: "abort" } };
    }
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.cancelCleanup(session);
      for (const pending of session.pending.values()) pending.reject(new Error("Codex app-server runner shut down"));
      session.pending.clear();
      if (session.child.exitCode === null && session.child.signalCode === null && !session.child.killed) {
        session.child.stdin?.end();
        session.child.kill("SIGTERM");
      }
      this.sessions.delete(session.key);
      session.emit("worker.codex.session.removed", { threadId: session.threadId, reason: "shutdown" });
    }
  }

  private spawnSession(key: string, input: WorkerRunnerStartInput): CodexSession {
    const [cmd, ...args] = commandParts(input.workflow.agent.command);
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
    const session: CodexSession = {
      key,
      child,
      nextId: 1,
      pending: new Map(),
      status: { status: "running", raw: { pid: child.pid } },
      activeTurn: false,
      initialized: Promise.resolve(),
      emit: input.emitEvent ?? (() => undefined),
    };
    child.once("error", (error) => {
      session.status = { status: "error", raw: { message: error.message, code: (error as NodeJS.ErrnoException).code } };
      session.emit("worker.codex.process.error", session.status.raw);
    });
    child.once("exit", (code, signal) => {
      if (session.status.status === "running") {
        session.status = signal === "SIGTERM" || signal === "SIGINT"
          ? { status: "interrupted", exitCode: code ?? undefined, raw: { code, signal } }
          : code === 0
            ? { status: "done", exitCode: 0, raw: { code, signal } }
            : { status: "error", exitCode: code ?? undefined, raw: { code, signal } };
      }
      for (const pending of session.pending.values()) pending.reject(new Error(`Codex app-server exited before responding (${signal ?? code ?? "unknown"})`));
      session.pending.clear();
      this.cancelCleanup(session);
      this.scheduleRetentionCleanup(session);
      session.emit("worker.codex.process.exit", { status: session.status.status, exitCode: session.status.exitCode, raw: session.status.raw });
    });
    child.stderr?.on("data", (chunk: Buffer) => session.emit("worker.codex.stderr", { text: chunk.toString("utf8") }));
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", (line) => this.receive(session, line));
    session.initialized = this.initialize(session, input);
    return session;
  }

  private async initialize(session: CodexSession, input: WorkerRunnerStartInput): Promise<void> {
    await this.request(session, "initialize", {
      clientInfo: { name: "aihub-orchestrator", version: "0.1.0" },
      capabilities: { experimentalApi: true },
      cwd: input.workspace,
    });
    this.notify(session, "initialized", {});
    session.emit("worker.codex.initialized", { pid: session.child.pid });
  }

  private async startTurn(session: CodexSession, prompt: string, input: WorkerRunnerStartInput): Promise<void> {
    if (!session.threadId) throw new Error("Codex thread was not started");
    session.status = { status: "running", raw: { pid: session.child.pid, threadId: session.threadId } };
    const result = await this.request(session, "turn/start", {
      threadId: session.threadId,
      input: textFromInput(prompt),
      cwd: input.workspace,
      model: input.workflow.agent.model ?? input.profile.model,
      approvalPolicy: input.workflow.agent.settings?.approvalPolicy,
      sandboxPolicy: input.workflow.agent.settings?.sandboxPolicy,
      effort: input.profile.reasoningEffort ?? input.profile.reasoning,
    });
    session.turnId = this.extractTurnId(result);
    session.activeTurn = true;
    session.emit("worker.codex.turn.started.request", { threadId: session.threadId, turnId: session.turnId, raw: result });
  }

  private async continueTurn(session: CodexSession, input: WorkerRunnerStartInput): Promise<void> {
    const guidance = `Continue the active orchestrator work for ${input.issue.identifier}. Reuse the current thread context and continue from the latest state.`;
    if (session.threadId && session.activeTurn && session.turnId) {
      await this.request(session, "turn/steer", { threadId: session.threadId, expectedTurnId: session.turnId, input: textFromInput(guidance) });
      session.emit("worker.codex.turn.continued", { mode: "steer", threadId: session.threadId, turnId: session.turnId });
      return;
    }
    await this.startTurn(session, guidance, input);
    session.emit("worker.codex.turn.continued", { mode: "new_turn", threadId: session.threadId, turnId: session.turnId });
  }

  private request(session: CodexSession, method: string, params: unknown): Promise<unknown> {
    const id = session.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      session.pending.set(id, { resolve, reject });
      session.child.stdin?.write(`${payload}\n`, (error) => {
        if (!error) return;
        session.pending.delete(id);
        reject(error);
      });
    });
  }

  private notify(session: CodexSession, method: string, params: unknown): void {
    session.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private respond(session: CodexSession, id: string | number, result: unknown): void {
    session.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  private rejectRequest(session: CodexSession, id: string | number, message: string): void {
    session.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } })}\n`);
  }

  private receive(session: CodexSession, line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      session.emit("worker.codex.protocol.error", { error: error instanceof Error ? error.message : String(error), line });
      return;
    }
    if ((typeof message.id === "string" || typeof message.id === "number") && session.pending.has(message.id)) {
      const pending = session.pending.get(message.id)!;
      session.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "Codex app-server request failed"));
      else pending.resolve(message.result);
      return;
    }
    if ((typeof message.id === "string" || typeof message.id === "number") && message.method) {
      this.handleServerRequest(session, message.id, message);
      return;
    }
    if (message.method) this.handleNotification(session, message);
  }

  private handleServerRequest(session: CodexSession, id: string | number, message: JsonRpcMessage): void {
    session.emit("worker.codex.server_request", { id, method: message.method, params: message.params });
    if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
      this.respond(session, id, "cancel");
      return;
    }
    this.rejectRequest(session, id, `Unsupported Codex app-server request: ${message.method ?? "unknown"}`);
  }

  private handleNotification(session: CodexSession, message: JsonRpcMessage): void {
    const method = message.method!;
    const params = objectValue(message.params);
    if (method === "turn/started") {
      const turn = objectValue(params?.turn);
      session.turnId = typeof turn?.id === "string" ? turn.id : session.turnId;
      session.activeTurn = true;
    } else if (method === "turn/completed") {
      const turn = objectValue(params?.turn);
      const status = turn?.status;
      session.activeTurn = false;
      session.status = status === "completed"
        ? { status: "done", exitCode: 0, raw: message.params }
        : status === "interrupted"
          ? { status: "interrupted", raw: message.params }
          : { status: "error", raw: message.params };
      this.scheduleIdleCleanup(session);
    } else if (method === "error") {
      session.status = { status: "error", raw: message.params };
      const error = objectValue(params?.error);
      const codexErrorInfo = objectValue(error?.codexErrorInfo);
      if (codexErrorInfo?.type === "UsageLimitExceeded" || codexErrorInfo?.httpStatusCode === 429) session.emit("worker.codex.rate_limit", message.params);
    } else if (method === "thread/tokenUsage/updated") {
      session.emit("worker.codex.tokens", message.params);
      return;
    } else if (method === "turn/diff/updated") {
      session.emit("worker.codex.tool", message.params);
      session.emit(`worker.codex.${method.replaceAll("/", ".")}`, message.params);
      return;
    }
    if (method.startsWith("item/")) {
      session.emit(this.itemEventType(method, message.params), message.params);
      return;
    }
    session.emit(`worker.codex.${method.replaceAll("/", ".")}`, message.params);
  }

  private itemEventType(method: string, params: unknown): string {
    const item = objectValue(objectValue(params)?.item);
    const type = typeof item?.type === "string" ? item.type : "item";
    if (method.includes("agentMessage")) return "worker.codex.message";
    if (method.includes("commandExecution") || method.includes("tool")) return "worker.codex.tool";
    if (type === "agentMessage") return "worker.codex.message";
    if (type === "commandExecution" || type === "fileChange" || type === "mcpToolCall" || type === "dynamicToolCall" || type === "collabToolCall" || type === "webSearch") return "worker.codex.tool";
    if (type === "contextCompaction") return "worker.codex.compaction";
    return `worker.codex.${method.replaceAll("/", ".")}`;
  }

  private extractThreadId(result: unknown): string | undefined {
    const thread = objectValue(objectValue(result)?.thread);
    return typeof thread?.id === "string" ? thread.id : undefined;
  }

  private extractTurnId(result: unknown): string | undefined {
    const turn = objectValue(objectValue(result)?.turn);
    return typeof turn?.id === "string" ? turn.id : undefined;
  }

  private handle(input: WorkerRunnerStartInput, session: CodexSession): WorkerRunnerHandle {
    return {
      id: `codex:${input.runId}:${session.threadId ?? session.child.pid ?? "unknown"}`,
      kind: "codex",
      pid: session.child.pid,
      raw: { pid: session.child.pid, threadId: session.threadId, turnId: session.turnId },
    };
  }

  private sessionFromHandle(handle: WorkerRunnerHandle): CodexSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.child.pid === handle.pid || handle.id.includes(session.threadId ?? "\u0000")) return session;
    }
    return undefined;
  }

  private canReuse(session: CodexSession): boolean {
    return Boolean(session.threadId) && session.child.exitCode === null && session.child.signalCode === null && !session.child.killed && (session.status.status === "running" || session.status.status === "done");
  }

  private scheduleIdleCleanup(session: CodexSession): void {
    if (session.cleanupTimer) return;
    session.cleanupTimer = setTimeout(() => {
      session.child.stdin?.end();
      if (session.child.exitCode === null && session.child.signalCode === null && !session.child.killed) session.child.kill("SIGTERM");
      this.scheduleRetentionCleanup(session);
    }, this.options.idleCleanupMs ?? 30_000);
  }

  private scheduleRetentionCleanup(session: CodexSession): void {
    if (session.retentionTimer) return;
    session.retentionTimer = setTimeout(() => {
      this.sessions.delete(session.key);
      session.emit("worker.codex.session.removed", { threadId: session.threadId });
    }, this.options.terminalRetentionMs ?? 300_000);
  }

  private cancelCleanup(session: CodexSession): void {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    if (session.retentionTimer) clearTimeout(session.retentionTimer);
    session.cleanupTimer = undefined;
    session.retentionTimer = undefined;
  }
}
