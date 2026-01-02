import fs from "node:fs/promises";
import path from "node:path";
import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";
import type {
  ThinkLevel,
  StreamEvent,
  SimpleHistoryMessage,
  FullHistoryMessage,
  ContentBlock,
  HistoryViewMode,
} from "@aihub/shared";
import { getAgent, resolveWorkspaceDir, CONFIG_DIR } from "../config/index.js";
import {
  setSessionStreaming,
  isStreaming,
  abortSession,
  setAgentSession,
  getAgentSession,
  clearAgentSession,
  bufferPendingMessage,
  popPendingMessages,
} from "./sessions.js";
import {
  ensureBootstrapFiles,
  loadBootstrapFiles,
  buildBootstrapContextFiles,
} from "./workspace.js";
import { resolveSessionId } from "../sessions/index.js";
import { agentEventBus, type AgentStreamEvent, type RunSource } from "./events.js";

export type RunAgentParams = {
  agentId: string;
  message: string;
  sessionId?: string;
  sessionKey?: string; // Resolves to sessionId with idle timeout + reset triggers
  thinkLevel?: ThinkLevel;
  source?: RunSource;
  onEvent?: (event: StreamEvent) => void;
};

export type RunAgentResult = {
  payloads: Array<{ text?: string; mediaUrls?: string[] }>;
  meta: {
    durationMs: number;
    sessionId: string;
    aborted?: boolean;
    queued?: boolean;
  };
};

const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");

// Max wait time for Pi session to be set during queue race
const QUEUE_WAIT_MS = 500;
const QUEUE_POLL_MS = 10;

// Max wait time for streaming to end during interrupt
const INTERRUPT_WAIT_MS = 2000;
const INTERRUPT_POLL_MS = 50;

async function ensureSessionsDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

function resolveSessionFile(agentId: string, sessionId: string): string {
  return path.join(SESSIONS_DIR, `${agentId}-${sessionId}.jsonl`);
}

function extractAssistantText(msg: AssistantMessage): string {
  if (!msg.content) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

/** Wait for Pi session to be available, with timeout */
async function waitForPiSession(
  agentId: string,
  sessionId: string
): Promise<PiAgentSession | undefined> {
  const deadline = Date.now() + QUEUE_WAIT_MS;
  while (Date.now() < deadline) {
    const session = getAgentSession(agentId, sessionId);
    if (session) return session;
    await new Promise((r) => setTimeout(r, QUEUE_POLL_MS));
  }
  return undefined;
}

/** Wait for streaming to end, with timeout */
async function waitForStreamingEnd(agentId: string, sessionId: string): Promise<boolean> {
  const deadline = Date.now() + INTERRUPT_WAIT_MS;
  while (Date.now() < deadline) {
    if (!isStreaming(agentId, sessionId)) return true;
    await new Promise((r) => setTimeout(r, INTERRUPT_POLL_MS));
  }
  return false;
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const agent = getAgent(params.agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${params.agentId}`);
  }

  // Resolve sessionId: explicit > sessionKey resolution > default
  let sessionId: string;
  let message = params.message;
  if (params.sessionId) {
    sessionId = params.sessionId;
  } else if (params.sessionKey) {
    const resolved = await resolveSessionId({
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      message: params.message,
    });
    sessionId = resolved.sessionId;
    message = resolved.message;
  } else {
    sessionId = "default";
  }

  // Helper to emit events to both callback and global bus
  const emit = (event: StreamEvent) => {
    params.onEvent?.(event);
    agentEventBus.emitStreamEvent({
      ...event,
      agentId: params.agentId,
      sessionId,
      sessionKey: params.sessionKey,
      source: params.source,
    } as AgentStreamEvent);
  };

  const currentlyStreaming = isStreaming(params.agentId, sessionId);

  // Handle queue vs interrupt mode when already streaming
  if (currentlyStreaming) {
    if (agent.queueMode === "queue") {
      // Wait for Pi session to be set (handles race with setSessionStreaming)
      const existingPiSession = await waitForPiSession(params.agentId, sessionId);

      if (existingPiSession) {
        // Queue mode: inject message into current Pi session
        await existingPiSession.queueMessage(message);
      } else {
        // Pi session not ready yet - buffer the message for later injection
        bufferPendingMessage(params.agentId, sessionId, message);
      }

      emit({ type: "text", data: "Message queued into current run" });
      emit({ type: "done", meta: { durationMs: 0 } });
      return {
        payloads: [{ text: "Message queued into current run" }],
        meta: { durationMs: 0, sessionId, queued: true },
      };
    }

    if (agent.queueMode === "interrupt") {
      // Interrupt mode: abort existing session and wait for it to end
      abortSession(params.agentId, sessionId);
      const ended = await waitForStreamingEnd(params.agentId, sessionId);
      if (!ended) {
        // Force clear the streaming state if it didn't end gracefully
        clearAgentSession(params.agentId, sessionId);
        setSessionStreaming(params.agentId, sessionId, false);
      }
    }
  }

  await ensureSessionsDir();
  const sessionFile = resolveSessionFile(params.agentId, sessionId);
  const workspaceDir = resolveWorkspaceDir(agent.workspace);

  // Ensure bootstrap files exist on first run
  await ensureBootstrapFiles(workspaceDir);

  const abortController = new AbortController();
  setSessionStreaming(params.agentId, sessionId, true, abortController);

  const started = Date.now();
  let aborted = false;

  try {
    // Dynamically import pi-coding-agent
    const {
      createAgentSession,
      SessionManager,
      SettingsManager,
      discoverAuthStorage,
      discoverModels,
      discoverSkills,
      discoverSlashCommands,
      buildSystemPrompt,
      createCodingTools,
    } = await import("@mariozechner/pi-coding-agent");
    const { getEnvApiKey } = await import("@mariozechner/pi-ai");

    // Resolve model - use CONFIG_DIR directly so Pi SDK reads ~/.aihub/models.json
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    const authStorage = discoverAuthStorage(CONFIG_DIR);
    const modelRegistry = discoverModels(authStorage, CONFIG_DIR);
    const model = modelRegistry.find(agent.model.provider, agent.model.model);

    if (!model) {
      throw new Error(`Model not found: ${agent.model.provider}/${agent.model.model}`);
    }

    // Get API key
    const storedKey = await authStorage.getApiKey(model.provider);
    const apiKey = storedKey ?? getEnvApiKey(model.provider);
    if (!apiKey) {
      throw new Error(`No API key for provider: ${model.provider}`);
    }
    authStorage.setRuntimeApiKey(model.provider, apiKey);

    // Discover skills from workspace/.pi/skills, ~/.pi/agent/skills, etc.
    const skills = discoverSkills(workspaceDir);

    // Discover slash commands from workspace/.pi/commands, ~/.pi/agent/commands
    const slashCommands = discoverSlashCommands(workspaceDir);

    // Load bootstrap context files (AGENTS.md, SOUL.md, etc.)
    const bootstrapFiles = await loadBootstrapFiles(workspaceDir);
    const contextFiles = buildBootstrapContextFiles(bootstrapFiles);

    // Create tools with correct cwd (pre-built codingTools use process.cwd())
    const tools = createCodingTools(workspaceDir);

    // Build system prompt with skills and context files
    const systemPrompt = buildSystemPrompt({
      cwd: workspaceDir,
      contextFiles,
      skills,
      tools,
    });

    const sessionManager = SessionManager.open(sessionFile, CONFIG_DIR);
    const settingsManager = SettingsManager.create(workspaceDir, CONFIG_DIR);

    const { session: agentSession } = await createAgentSession({
      cwd: workspaceDir,
      agentDir: CONFIG_DIR,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: params.thinkLevel ?? agent.thinkLevel ?? "off",
      systemPrompt,
      tools,
      sessionManager,
      settingsManager,
      skills,
      slashCommands,
      contextFiles,
    });

    // Store the Pi session for queue injection BEFORE any async work
    setAgentSession(params.agentId, sessionId, agentSession as PiAgentSession);

    // Inject any buffered messages that arrived before Pi session was ready
    const bufferedMessages = popPendingMessages(params.agentId, sessionId);
    for (const bufferedMsg of bufferedMessages) {
      await agentSession.queueMessage(bufferedMsg);
    }

    // Handle abort
    abortController.signal.addEventListener("abort", () => {
      aborted = true;
      agentSession.abort();
    });

    // Subscribe to streaming events
    let deltaBuffer = "";
    const unsubscribe = agentSession.subscribe((evt) => {
      if (evt.type === "message_update") {
        const msg = (evt as { message?: AppMessage }).message;
        if (msg?.role === "assistant") {
          const assistantEvent = (evt as { assistantMessageEvent?: unknown })
            .assistantMessageEvent as Record<string, unknown> | undefined;
          const evtType = assistantEvent?.type as string | undefined;

          if (evtType === "text_delta") {
            const chunk = assistantEvent?.delta as string;
            if (chunk) {
              deltaBuffer += chunk;
              emit({ type: "text", data: chunk });
            }
          }
        }
      }

      if (evt.type === "tool_execution_start") {
        const toolName = (evt as { toolName?: string }).toolName ?? "unknown";
        emit({ type: "tool_start", toolName });
      }

      if (evt.type === "tool_execution_end") {
        const toolName = (evt as { toolName?: string }).toolName ?? "unknown";
        const isError = (evt as { isError?: boolean }).isError ?? false;
        emit({ type: "tool_end", toolName, isError });
      }
    });

    try {
      // Run the prompt
      await agentSession.prompt(message);
    } finally {
      unsubscribe();
    }

    const durationMs = Date.now() - started;
    emit({ type: "done", meta: { durationMs } });

    // Extract text from the last assistant message
    const messages = agentSession.messages;
    const lastAssistant = messages
      .slice()
      .reverse()
      .find((m: AppMessage) => m.role === "assistant") as AssistantMessage | undefined;

    const assistantText = lastAssistant ? extractAssistantText(lastAssistant) : "";

    agentSession.dispose();

    return {
      payloads: assistantText ? [{ text: assistantText }] : [],
      meta: { durationMs, sessionId, aborted },
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: errMessage });
    throw err;
  } finally {
    clearAgentSession(params.agentId, sessionId);
    setSessionStreaming(params.agentId, sessionId, false);
  }
}

export async function queueOrRun(params: RunAgentParams): Promise<RunAgentResult> {
  // This function is now simplified - runAgent handles queue/interrupt internally
  return runAgent(params);
}

// Re-export types for backward compatibility
export type { SimpleHistoryMessage, FullHistoryMessage, HistoryViewMode };

/** @deprecated Use SimpleHistoryMessage instead */
export type HistoryMessage = SimpleHistoryMessage;

/**
 * Parse raw content blocks from session file
 */
function parseContentBlocks(content: unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const c of content) {
    const block = c as Record<string, unknown>;
    if (block.type === "thinking" && typeof block.thinking === "string") {
      blocks.push({ type: "thinking", thinking: block.thinking });
    } else if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
      blocks.push({
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments: block.arguments,
      });
    }
  }
  return blocks;
}

/**
 * Extract text-only content from message
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } =>
      c && typeof c === "object" && c.type === "text" && typeof c.text === "string"
    )
    .map((c) => c.text)
    .join("\n");
}

/**
 * Load conversation history from session transcript file (simple view)
 */
export async function getSessionHistory(
  agentId: string,
  sessionId: string
): Promise<SimpleHistoryMessage[]> {
  const sessionFile = resolveSessionFile(agentId, sessionId);
  const messages: SimpleHistoryMessage[] = [];

  try {
    const content = await fs.readFile(sessionFile, "utf-8");
    const lines = content.trim().split("\n");

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message") continue;

        const msg = entry.message;
        if (!msg || !msg.role) continue;

        if (msg.role === "user") {
          const text = extractTextContent(msg.content);
          if (text) {
            messages.push({ role: "user", content: text, timestamp: msg.timestamp });
          }
        } else if (msg.role === "assistant") {
          const text = extractTextContent(msg.content);
          if (text) {
            messages.push({ role: "assistant", content: text, timestamp: msg.timestamp });
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist or not readable - return empty
  }

  return messages;
}

/**
 * Load full conversation history with all content blocks
 */
export async function getFullSessionHistory(
  agentId: string,
  sessionId: string
): Promise<FullHistoryMessage[]> {
  const sessionFile = resolveSessionFile(agentId, sessionId);
  const messages: FullHistoryMessage[] = [];

  try {
    const content = await fs.readFile(sessionFile, "utf-8");
    const lines = content.trim().split("\n");

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message") continue;

        const msg = entry.message as Record<string, unknown>;
        if (!msg || !msg.role) continue;

        const timestamp = (msg.timestamp as number) ?? Date.now();
        const rawContent = msg.content as unknown[];

        if (msg.role === "user") {
          const contentBlocks = Array.isArray(rawContent) ? parseContentBlocks(rawContent) : [];
          if (contentBlocks.length > 0) {
            messages.push({ role: "user", content: contentBlocks, timestamp });
          }
        } else if (msg.role === "assistant") {
          const contentBlocks = Array.isArray(rawContent) ? parseContentBlocks(rawContent) : [];
          messages.push({
            role: "assistant",
            content: contentBlocks,
            timestamp,
            meta: {
              api: msg.api as string | undefined,
              provider: msg.provider as string | undefined,
              model: msg.model as string | undefined,
              usage: msg.usage as FullHistoryMessage extends { role: "assistant"; meta?: { usage?: infer U } } ? U : undefined,
              stopReason: msg.stopReason as string | undefined,
            },
          });
        } else if (msg.role === "toolResult") {
          const contentBlocks = Array.isArray(rawContent) ? parseContentBlocks(rawContent) : [];
          const details = msg.details as Record<string, unknown> | undefined;
          messages.push({
            role: "toolResult",
            toolCallId: msg.toolCallId as string,
            toolName: msg.toolName as string,
            content: contentBlocks,
            isError: (msg.isError as boolean) ?? false,
            details: details?.diff ? { diff: details.diff as string } : undefined,
            timestamp,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist or not readable - return empty
  }

  return messages;
}
