import fs from "node:fs/promises";
import path from "node:path";
import type {
  ThinkLevel,
  StreamEvent,
  SimpleHistoryMessage,
  FullHistoryMessage,
  HistoryViewMode,
  AgentContext,
  FileAttachment,
} from "@aihub/shared";
import { getAgent, resolveWorkspaceDir, CONFIG_DIR } from "../config/index.js";
import {
  setSessionStreaming,
  isStreaming,
  abortSession,
  setSessionHandle,
  getSessionHandle,
  clearSessionHandle,
  bufferPendingMessage,
  popPendingMessages,
  enqueuePendingUserMessage,
  shiftPendingUserMessage,
  popAllPendingUserMessages,
} from "./sessions.js";
import { resolveSessionId, clearClaudeSessionId, getSessionEntry, isAbortTrigger } from "../sessions/index.js";
import { parseThinkDirective } from "../sessions/directives.js";
import { getSessionThinkLevel, setSessionThinkLevel, DEFAULT_MAIN_KEY } from "../sessions/store.js";
import { appendSessionMeta } from "../history/store.js";
import { agentEventBus, type AgentStreamEvent, type RunSource } from "./events.js";
import { getSdkAdapter, getDefaultSdkId } from "../sdk/registry.js";
import type { SdkId, HistoryEvent } from "../sdk/types.js";
import {
  createTurnBuffer,
  bufferHistoryEvent,
  type TurnBuffer,
  flushTurnBuffer,
  getSimpleHistory as getCanonicalSimpleHistory,
  getFullHistory as getCanonicalFullHistory,
  hasCanonicalHistory,
  backfillFromPiSession,
  backfillFromClaudeSessionIfNeeded,
} from "../history/store.js";

export type RunAgentParams = {
  agentId: string;
  message: string;
  attachments?: FileAttachment[]; // file attachments (paths from upload)
  sessionId?: string;
  sessionKey?: string; // Resolves to sessionId with idle timeout + reset triggers
  thinkLevel?: ThinkLevel;
  context?: AgentContext; // Structured context (Discord metadata, etc.)
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

// Thinking levels in fallback order (highest to lowest)
const THINK_LEVELS_ORDERED: ThinkLevel[] = ["xhigh", "high", "medium", "low", "minimal", "off"];

/**
 * Check if error is a thinking level unsupported error
 */
function isThinkingLevelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /thinking.*not.*supported|unsupported.*thinking|budget_tokens.*invalid|reasoning_effort.*invalid/i.test(msg);
}

// Max wait time for session handle to be set during queue race
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

/** Wait for session handle to be available, with timeout */
async function waitForSessionHandle(
  agentId: string,
  sessionId: string
): Promise<unknown | undefined> {
  const deadline = Date.now() + QUEUE_WAIT_MS;
  while (Date.now() < deadline) {
    const handle = getSessionHandle(agentId, sessionId);
    if (handle) return handle;
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

  // Resolve SDK adapter
  const sdkId = (agent.sdk ?? getDefaultSdkId()) as SdkId;
  const adapter = getSdkAdapter(sdkId);
  const capabilities = adapter.capabilities;

  // Handle /abort command early - do NOT create new sessions or forward to model
  if (isAbortTrigger(params.message)) {
    // Resolve session without creating new one
    let sessionId: string | undefined;
    if (params.sessionId) {
      sessionId = params.sessionId;
    } else if (params.sessionKey) {
      const entry = getSessionEntry(params.agentId, params.sessionKey);
      sessionId = entry?.sessionId;
    } else {
      sessionId = "default";
    }

    // No active session to abort
    if (!sessionId) {
      const emit = (event: StreamEvent) => {
        params.onEvent?.(event);
        agentEventBus.emitStreamEvent({
          ...event,
          agentId: params.agentId,
          sessionId: "none",
          sessionKey: params.sessionKey,
          source: params.source,
        } as AgentStreamEvent);
      };
      emit({ type: "text", data: "No active run." });
      emit({ type: "done", meta: { durationMs: 0, aborted: false } });
      return {
        payloads: [{ text: "No active run." }],
        meta: { durationMs: 0, sessionId: "none", aborted: false },
      };
    }

    // Emit helper for abort flow
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

    const wasStreaming = isStreaming(params.agentId, sessionId);
    let aborted = false;

    if (wasStreaming) {
      // Attempt to interrupt via adapter
      if (capabilities.interrupt && adapter.abort) {
        const handle = getSessionHandle(params.agentId, sessionId);
        if (handle) {
          adapter.abort(handle);
        }
      }
      // Trip the AbortController
      abortSession(params.agentId, sessionId);

      // Wait for streaming to end
      const ended = await waitForStreamingEnd(params.agentId, sessionId);
      if (!ended) {
        // Force clear stuck state
        clearSessionHandle(params.agentId, sessionId);
        setSessionStreaming(params.agentId, sessionId, false);
      }
      aborted = true;
    }

    const ackText = aborted ? "Run aborted." : "No active run.";
    emit({ type: "text", data: ackText });
    emit({ type: "done", meta: { durationMs: 0, aborted } });
    return {
      payloads: [{ text: ackText }],
      meta: { durationMs: 0, sessionId, aborted },
    };
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
    // Clear Claude SDK session mapping on reset (new session via /new, /reset, or idle timeout)
    if (resolved.isNew) {
      await clearClaudeSessionId(params.agentId, sessionId);
    }
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

  // Resolve sessionKey for thinkLevel persistence (OAuth only)
  const resolvedSessionKey = params.sessionKey ?? DEFAULT_MAIN_KEY;
  const isOAuth = agent.auth?.mode === "oauth";

  // Handle /think directive (OAuth agents only)
  let directiveThinkLevel: ThinkLevel | undefined;
  if (isOAuth) {
    const directive = parseThinkDirective(message);
    if (directive.hasDirective) {
      // Update message with directive stripped
      message = directive.message;

      if (directive.thinkLevel) {
        // /think level - update session state and persist
        directiveThinkLevel = directive.thinkLevel;
        await setSessionThinkLevel(params.agentId, resolvedSessionKey, directive.thinkLevel, sessionId);
        await appendSessionMeta(params.agentId, sessionId, "thinkingLevel", directive.thinkLevel);

        // If no remaining message, just acknowledge and return
        if (!message.trim()) {
          const ackText = `Thinking level set to: ${directive.thinkLevel}`;
          emit({ type: "text", data: ackText });
          emit({ type: "done", meta: { durationMs: 0 } });
          return {
            payloads: [{ text: ackText }],
            meta: { durationMs: 0, sessionId },
          };
        }
      } else if (directive.rawLevel) {
        // Invalid level specified
        const validLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "min", "mid", "med", "max", "ultra", "none"];
        const errText = `Invalid thinking level: "${directive.rawLevel}". Valid levels: ${validLevels.join(", ")}`;
        emit({ type: "text", data: errText });
        emit({ type: "done", meta: { durationMs: 0 } });
        return {
          payloads: [{ text: errText }],
          meta: { durationMs: 0, sessionId },
        };
      } else {
        // /think with no arg - show current level
        const currentLevel = getSessionThinkLevel(params.agentId, resolvedSessionKey) ?? agent.thinkLevel ?? "not set";
        const statusText = `Current thinking level: ${currentLevel}`;
        emit({ type: "text", data: statusText });
        emit({ type: "done", meta: { durationMs: 0 } });
        return {
          payloads: [{ text: statusText }],
          meta: { durationMs: 0, sessionId },
        };
      }
    }
  }

  // Resolve thinkLevel:
  // - OAuth: API param > Directive > Session > Config > undefined
  // - Non-OAuth: API param > Config > undefined (no directive/session support)
  let resolvedThinkLevel: ThinkLevel | undefined;
  if (isOAuth) {
    resolvedThinkLevel =
      params.thinkLevel ??
      directiveThinkLevel ??
      getSessionThinkLevel(params.agentId, resolvedSessionKey) ??
      agent.thinkLevel;
  } else {
    // Non-OAuth: still honor API param and config, just no directive/session
    resolvedThinkLevel = params.thinkLevel ?? agent.thinkLevel;
  }

  const currentlyStreaming = isStreaming(params.agentId, sessionId);

  // Handle queue vs interrupt mode when already streaming
  if (currentlyStreaming) {
    if (agent.queueMode === "queue") {
      if (capabilities.queueWhileStreaming && adapter.queueMessage) {
        // Track user message for the next assistant turn
        enqueuePendingUserMessage(params.agentId, sessionId, message, Date.now());
        // Adapter supports native queue - wait for session handle
        const existingHandle = await waitForSessionHandle(params.agentId, sessionId);
        if (existingHandle) {
          await adapter.queueMessage(existingHandle, message);
        } else {
          // Handle not ready - buffer for later
          bufferPendingMessage(params.agentId, sessionId, message);
        }
      } else {
        // Adapter lacks queue support - buffer message for sequential drain
        bufferPendingMessage(params.agentId, sessionId, message);
      }

      const queueNote = capabilities.queueWhileStreaming
        ? "Message queued into current run"
        : "Message queued for next run";
      emit({ type: "text", data: queueNote });
      emit({ type: "done", meta: { durationMs: 0, queued: true } });
      return {
        payloads: [{ text: queueNote }],
        meta: { durationMs: 0, sessionId, queued: true },
      };
    }

    if (agent.queueMode === "interrupt") {
      if (capabilities.interrupt && adapter.abort) {
        // Adapter supports interrupt
        const handle = getSessionHandle(params.agentId, sessionId);
        if (handle) {
          adapter.abort(handle);
        }
        abortSession(params.agentId, sessionId);
      } else {
        // Fall back to abort controller only
        abortSession(params.agentId, sessionId);
      }
      const ended = await waitForStreamingEnd(params.agentId, sessionId);
      if (!ended) {
        // Force clear if not ended gracefully
        clearSessionHandle(params.agentId, sessionId);
        setSessionStreaming(params.agentId, sessionId, false);
      }
    }
  }

  await ensureSessionsDir();
  const workspaceDir = resolveWorkspaceDir(agent.workspace);

  const abortController = new AbortController();
  setSessionStreaming(params.agentId, sessionId, true, abortController);

  const started = Date.now();
  let aborted = false;
  let runCompleted = false;

  // Turn buffers for assembling history events (sync, no I/O during streaming)
  let currentTurn: TurnBuffer | null = null;
  const completedTurns: TurnBuffer[] = [];

  const startTurnWithUser = (event: Extract<HistoryEvent, { type: "user" }>) => {
    const buffer = createTurnBuffer();
    bufferHistoryEvent(buffer, event);
    if (!currentTurn) {
      currentTurn = buffer;
    } else {
      enqueuePendingUserMessage(params.agentId, sessionId, event.text, event.timestamp);
    }
  };

  const ensureCurrentTurn = (): TurnBuffer => {
    if (!currentTurn) {
      const pendingUser = shiftPendingUserMessage(params.agentId, sessionId);
      currentTurn = createTurnBuffer();
      if (pendingUser) {
        bufferHistoryEvent(currentTurn, {
          type: "user",
          text: pendingUser.text,
          timestamp: pendingUser.timestamp,
        });
      }
    }
    return currentTurn;
  };

  const finishCurrentTurn = () => {
    if (currentTurn) {
      completedTurns.push(currentTurn);
      currentTurn = null;
    }
  };

  // History event handler - buffers events synchronously
  const handleHistoryEvent = (event: HistoryEvent): void => {
    if (event.type === "user") {
      startTurnWithUser(event);
      return;
    }
    if (event.type === "turn_end") {
      finishCurrentTurn();
      return;
    }
    const buffer = ensureCurrentTurn();
    bufferHistoryEvent(buffer, event);
  };

  try {
    // Run with fallback retry for unsupported thinking levels
    let hasEmittedContent = false;
    let actualThinkLevel = resolvedThinkLevel;
    let fallbackUsed = false;

    const runParams = {
      agentId: params.agentId,
      agent,
      sessionId,
      sessionKey: params.sessionKey,
      message,
      attachments: params.attachments,
      workspaceDir,
      context: params.context,
      onEvent: (event: StreamEvent) => {
        if (event.type === "text" || event.type === "thinking") {
          hasEmittedContent = true;
        }
        emit(event);
      },
      onHistoryEvent: handleHistoryEvent,
      onSessionHandle: (handle: unknown) => {
        setSessionHandle(params.agentId, sessionId, handle);
        // Inject buffered messages if adapter supports queue
        if (capabilities.queueWhileStreaming && adapter.queueMessage) {
          const buffered = popPendingMessages(params.agentId, sessionId);
          for (const msg of buffered) {
            adapter.queueMessage!(handle, msg);
          }
        }
      },
      abortSignal: abortController.signal,
    };

    let result: Awaited<ReturnType<typeof adapter.run>>;
    const startIdx = actualThinkLevel ? THINK_LEVELS_ORDERED.indexOf(actualThinkLevel) : -1;
    const attempted = new Set<ThinkLevel>();

    if (startIdx === -1 || !actualThinkLevel) {
      // No thinking level set, run normally
      result = await adapter.run({ ...runParams, thinkLevel: undefined });
    } else {
      // Try with fallback on thinking level errors
      let lastError: unknown;
      for (let i = startIdx; i < THINK_LEVELS_ORDERED.length; i++) {
        const level = THINK_LEVELS_ORDERED[i];
        if (attempted.has(level)) continue;
        attempted.add(level);

        try {
          result = await adapter.run({ ...runParams, thinkLevel: level });
          actualThinkLevel = level;
          fallbackUsed = level !== resolvedThinkLevel;
          break;
        } catch (err) {
          lastError = err;
          // Only retry if no content emitted yet and it's a thinking level error
          if (!hasEmittedContent && isThinkingLevelError(err)) {
            continue;
          }
          throw err;
        }
      }
      // If loop exhausted without success, throw last error
      if (!result!) {
        throw lastError ?? new Error("All thinking levels failed");
      }
    }

    // Add fallback note if a different level was used
    if (fallbackUsed && actualThinkLevel !== resolvedThinkLevel) {
      const note = `\n\n_Note: Used thinking level "${actualThinkLevel}" ("${resolvedThinkLevel}" not supported by model)_`;
      emit({ type: "text", data: note });
    }

    aborted = result.aborted ?? false;

    // Flush completed turns first
    for (const buffer of completedTurns) {
      await flushTurnBuffer(params.agentId, sessionId, buffer);
    }
    // Flush any in-progress turn
    if (currentTurn) {
      await flushTurnBuffer(params.agentId, sessionId, currentTurn);
      currentTurn = null;
    }
    // Flush any pending user-only turns (queued but not processed)
    const pendingUsers = popAllPendingUserMessages(params.agentId, sessionId);
    for (const pending of pendingUsers) {
      const buffer = createTurnBuffer();
      bufferHistoryEvent(buffer, {
        type: "user",
        text: pending.text,
        timestamp: pending.timestamp,
      });
      await flushTurnBuffer(params.agentId, sessionId, buffer);
    }

    const durationMs = Date.now() - started;
    emit({ type: "done", meta: { durationMs } });
    runCompleted = true;

    return {
      payloads: result.text ? [{ text: result.text }] : [],
      meta: { durationMs, sessionId, aborted },
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: errMessage });
    throw err;
  } finally {
    clearSessionHandle(params.agentId, sessionId);
    setSessionStreaming(params.agentId, sessionId, false);

    // Drain pending queue if adapter lacks native queue support
    if (runCompleted && !capabilities.queueWhileStreaming) {
      const pendingMessages = popPendingMessages(params.agentId, sessionId);
      for (const pendingMsg of pendingMessages) {
        // Run next message - omit onEvent to use agentEventBus only
        await runAgent({
          agentId: params.agentId,
          message: pendingMsg,
          sessionId,
          sessionKey: params.sessionKey,
          thinkLevel: params.thinkLevel,
          source: params.source,
          // onEvent omitted - events go to agentEventBus only
        });
      }
    }
  }
}

export async function queueOrRun(params: RunAgentParams): Promise<RunAgentResult> {
  return runAgent(params);
}

// Re-export types for backward compatibility
export type { SimpleHistoryMessage, FullHistoryMessage, HistoryViewMode };

/** @deprecated Use SimpleHistoryMessage instead */
export type HistoryMessage = SimpleHistoryMessage;

/**
 * Load conversation history (simple view)
 * Uses canonical history store, with one-time backfill from Pi session files
 */
export async function getSessionHistory(
  agentId: string,
  sessionId: string
): Promise<SimpleHistoryMessage[]> {
  // One-time backfill from Pi session if canonical doesn't exist
  await backfillFromPiSession(agentId, sessionId);
  await backfillFromClaudeSessionIfNeeded(agentId, sessionId);

  // Try canonical history
  if (await hasCanonicalHistory(agentId, sessionId)) {
    return getCanonicalSimpleHistory(agentId, sessionId);
  }

  // No history exists
  return [];
}

/**
 * Load full conversation history with all content blocks
 * Uses canonical history store, with one-time backfill from Pi session files
 */
export async function getFullSessionHistory(
  agentId: string,
  sessionId: string
): Promise<FullHistoryMessage[]> {
  // One-time backfill from Pi session if canonical doesn't exist
  await backfillFromPiSession(agentId, sessionId);
  await backfillFromClaudeSessionIfNeeded(agentId, sessionId);

  // Try canonical history
  if (await hasCanonicalHistory(agentId, sessionId)) {
    return getCanonicalFullHistory(agentId, sessionId);
  }

  // No history exists
  return [];
}
