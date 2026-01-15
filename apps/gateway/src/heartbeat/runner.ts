import fs from "node:fs/promises";
import path from "node:path";
import type { AgentConfig, HeartbeatEventPayload, HeartbeatStatus } from "@aihub/shared";
import { loadConfig, getAgent, resolveWorkspaceDir } from "../config/index.js";
import { runAgent } from "../agents/runner.js";
import { isStreaming } from "../agents/sessions.js";
import {
  getSessionEntry,
  restoreSessionUpdatedAt,
  DEFAULT_MAIN_KEY,
} from "../sessions/store.js";
import { resolveSessionId } from "../sessions/index.js";

// Default heartbeat interval (30 minutes)
const DEFAULT_HEARTBEAT_EVERY = "30m";
// Default ackMaxChars threshold
const DEFAULT_ACK_MAX_CHARS = 300;
// Default heartbeat prompt
export const DEFAULT_HEARTBEAT_PROMPT =
  "Consider outstanding tasks and HEARTBEAT.md guidance from the workspace context (if present). Checkup sometimes on your human during (user local) day time.";

// Global toggle for all heartbeats
let heartbeatsEnabled = true;

// Active timers per agent
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// Event listeners
type HeartbeatEventListener = (payload: HeartbeatEventPayload) => void;
const eventListeners = new Set<HeartbeatEventListener>();

/**
 * Token stripping pattern: handles HTML/Markdown wrapped HEARTBEAT_OK
 * Strips: <b>HEARTBEAT_OK</b>, <strong>HEARTBEAT_OK</strong>, **HEARTBEAT_OK**, *HEARTBEAT_OK*, etc.
 * Uses word boundary \b to avoid matching partial words like "HEARTBEAT_OKAY".
 * Note: underscore markdown (_HEARTBEAT_OK_) is not supported because `_` is a word character.
 */
const TOKEN_PATTERN_STR =
  "(?:<\\/?(?:b|strong|em|i|code|span)[^>]*>|\\*{1,2})*\\bHEARTBEAT_OK\\b(?:<\\/?(?:b|strong|em|i|code|span)[^>]*>|\\*{1,2})*";

/**
 * Create fresh regex for matching (avoids stateful lastIndex issues with g flag)
 */
function createTokenRegex(): RegExp {
  return new RegExp(TOKEN_PATTERN_STR, "gi");
}

/**
 * Parse duration string to milliseconds.
 * Supports: "5" (5 minutes), "5m" (5 minutes), "2h" (2 hours), "0" (disabled)
 * Returns null for disabled or invalid durations.
 */
export function parseDurationMs(
  duration: string | undefined,
  options?: { defaultUnit?: "m" | "h" | "s" }
): number | null {
  if (!duration) return null;

  const trimmed = duration.trim().toLowerCase();
  if (trimmed === "0" || trimmed === "0m" || trimmed === "0h" || trimmed === "0s") {
    return null; // Disabled
  }

  // Parse number and optional unit
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|s|sec)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (value <= 0 || !Number.isFinite(value)) return null;

  const unit = match[2] || options?.defaultUnit || "m";

  switch (unit) {
    case "s":
    case "sec":
      return value * 1000;
    case "m":
    case "min":
      return value * 60 * 1000;
    case "h":
    case "hr":
      return value * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Strip HEARTBEAT_OK token (including HTML/Markdown wrapped variants) from text.
 * Returns the remaining text after stripping.
 */
export function stripHeartbeatToken(text: string): string {
  return text.replace(createTokenRegex(), "").trim();
}

/**
 * Check if text contains HEARTBEAT_OK token.
 */
export function containsHeartbeatToken(text: string): boolean {
  return createTokenRegex().test(text);
}

/**
 * Determine heartbeat result status based on reply content.
 */
export function evaluateHeartbeatReply(
  replyText: string | undefined,
  ackMaxChars: number
): { status: HeartbeatStatus; strippedText: string; shouldDeliver: boolean } {
  // Empty reply
  if (!replyText || replyText.trim() === "") {
    return { status: "ok-empty", strippedText: "", shouldDeliver: false };
  }

  const hasToken = containsHeartbeatToken(replyText);
  const strippedText = stripHeartbeatToken(replyText);

  // Token present and remaining text within threshold
  if (hasToken && strippedText.length <= ackMaxChars) {
    return { status: "ok-token", strippedText, shouldDeliver: false };
  }

  // Alert: either no token or substantial content beyond threshold
  return { status: "sent", strippedText: strippedText || replyText.trim(), shouldDeliver: true };
}

/**
 * Load heartbeat prompt for an agent.
 * Resolution order: config > HEARTBEAT.md > default
 */
export async function loadHeartbeatPrompt(agent: AgentConfig): Promise<string> {
  // 1. Config value
  if (agent.heartbeat?.prompt) {
    return agent.heartbeat.prompt;
  }

  // 2. HEARTBEAT.md in workspace
  try {
    const workspaceDir = resolveWorkspaceDir(agent.workspace);
    const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");
    const content = await fs.readFile(heartbeatPath, "utf-8");
    if (content.trim()) {
      return content.trim();
    }
  } catch {
    // File doesn't exist or can't be read - fall through to default
  }

  // 3. Default prompt
  return DEFAULT_HEARTBEAT_PROMPT;
}

/**
 * Emit heartbeat event to all listeners.
 */
function emitHeartbeatEvent(payload: HeartbeatEventPayload): void {
  for (const listener of eventListeners) {
    try {
      listener(payload);
    } catch {
      // Ignore listener errors
    }
  }
}

/**
 * Subscribe to heartbeat events.
 * Returns unsubscribe function.
 */
export function onHeartbeatEvent(listener: HeartbeatEventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

/**
 * Global toggle to enable/disable all heartbeats.
 */
export function setHeartbeatsEnabled(enabled: boolean): void {
  heartbeatsEnabled = enabled;
}

/**
 * Check if heartbeats are globally enabled.
 */
export function areHeartbeatsEnabled(): boolean {
  return heartbeatsEnabled;
}

/**
 * Run a single heartbeat for an agent.
 * Returns the event payload describing the result.
 */
export async function runHeartbeat(agentId: string): Promise<HeartbeatEventPayload> {
  const startTs = Date.now();
  const agent = getAgent(agentId);

  // Agent not found
  if (!agent) {
    const payload: HeartbeatEventPayload = {
      ts: startTs,
      agentId,
      status: "failed",
      reason: "agent not found",
    };
    emitHeartbeatEvent(payload);
    return payload;
  }

  // Global disable check
  if (!heartbeatsEnabled) {
    const payload: HeartbeatEventPayload = {
      ts: startTs,
      agentId,
      status: "skipped",
      reason: "disabled",
    };
    emitHeartbeatEvent(payload);
    return payload;
  }

  // Capture original updatedAt for restoration
  const originalEntry = getSessionEntry(agentId, DEFAULT_MAIN_KEY);
  const originalUpdatedAt = originalEntry?.updatedAt;

  // Check if main session is streaming
  const sessionId = originalEntry?.sessionId;
  if (sessionId && isStreaming(agentId, sessionId)) {
    // Restore updatedAt since we're skipping
    await restoreSessionUpdatedAt(agentId, DEFAULT_MAIN_KEY, originalUpdatedAt);
    const payload: HeartbeatEventPayload = {
      ts: startTs,
      agentId,
      status: "skipped",
      reason: "streaming",
    };
    emitHeartbeatEvent(payload);
    return payload;
  }

  // Check delivery target (Discord broadcastToChannel)
  const broadcastChannel = agent.discord?.broadcastToChannel;
  if (!broadcastChannel) {
    // Restore updatedAt since no delivery target
    await restoreSessionUpdatedAt(agentId, DEFAULT_MAIN_KEY, originalUpdatedAt);
    const payload: HeartbeatEventPayload = {
      ts: startTs,
      agentId,
      status: "skipped",
      reason: "no broadcastToChannel",
    };
    emitHeartbeatEvent(payload);
    return payload;
  }

  const ackMaxChars = agent.heartbeat?.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS;

  try {
    // Load prompt
    const prompt = await loadHeartbeatPrompt(agent);

    // Run agent with heartbeat source
    // Use sessionKey "main" but don't save to user-visible history
    const resolved = await resolveSessionId({
      agentId,
      sessionKey: DEFAULT_MAIN_KEY,
      message: prompt,
    });

    const result = await runAgent({
      agentId,
      message: prompt,
      sessionId: resolved.sessionId,
      sessionKey: DEFAULT_MAIN_KEY,
      source: "heartbeat",
      // No onEvent - we don't want heartbeat runs in user-visible history
    });

    const durationMs = Date.now() - startTs;
    const replyText = result.payloads.map((p) => p.text).join("\n");

    // Evaluate reply
    const evaluation = evaluateHeartbeatReply(replyText, ackMaxChars);

    // Restore updatedAt if not delivering
    if (!evaluation.shouldDeliver) {
      await restoreSessionUpdatedAt(agentId, DEFAULT_MAIN_KEY, originalUpdatedAt);
    }

    const payload: HeartbeatEventPayload = {
      ts: startTs,
      agentId,
      status: evaluation.status,
      durationMs,
      to: evaluation.shouldDeliver ? broadcastChannel : undefined,
      preview: evaluation.strippedText.slice(0, 200) || undefined,
      alertText: evaluation.shouldDeliver ? evaluation.strippedText : undefined,
    };
    emitHeartbeatEvent(payload);
    return payload;
  } catch (err) {
    // Restore updatedAt on failure
    await restoreSessionUpdatedAt(agentId, DEFAULT_MAIN_KEY, originalUpdatedAt);
    const payload: HeartbeatEventPayload = {
      ts: startTs,
      agentId,
      status: "failed",
      durationMs: Date.now() - startTs,
      reason: err instanceof Error ? err.message : String(err),
    };
    emitHeartbeatEvent(payload);
    return payload;
  }
}

/**
 * Check if heartbeat is enabled for an agent.
 */
export function isHeartbeatEnabled(agent: AgentConfig): boolean {
  // No heartbeat block = disabled
  if (!agent.heartbeat) return false;

  // Explicit disable via "0"
  const every = agent.heartbeat.every;
  if (every !== undefined) {
    const ms = parseDurationMs(every, { defaultUnit: "m" });
    return ms !== null && ms > 0;
  }

  // heartbeat block present but no every = use default (enabled)
  return true;
}

/**
 * Get heartbeat interval for an agent in milliseconds.
 * Returns null if heartbeat is disabled.
 */
export function getHeartbeatIntervalMs(agent: AgentConfig): number | null {
  if (!isHeartbeatEnabled(agent)) return null;

  const every = agent.heartbeat?.every;
  if (every) {
    return parseDurationMs(every, { defaultUnit: "m" });
  }

  // Default interval
  return parseDurationMs(DEFAULT_HEARTBEAT_EVERY, { defaultUnit: "m" });
}

/**
 * Schedule heartbeat tick for an agent.
 */
function scheduleTick(agentId: string, intervalMs: number): void {
  // Clear existing timer
  const existing = timers.get(agentId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    // Run heartbeat
    await runHeartbeat(agentId);

    // Reschedule (if still configured)
    const agent = getAgent(agentId);
    if (agent && isHeartbeatEnabled(agent)) {
      const newInterval = getHeartbeatIntervalMs(agent);
      if (newInterval) {
        scheduleTick(agentId, newInterval);
      }
    } else {
      timers.delete(agentId);
    }
  }, intervalMs);

  // Don't block process exit
  timer.unref?.();
  timers.set(agentId, timer);
}

/**
 * Start heartbeat for an agent.
 * Returns true if heartbeat was started, false if disabled.
 */
export function startHeartbeat(agentId: string): boolean {
  const agent = getAgent(agentId);
  if (!agent) return false;

  const intervalMs = getHeartbeatIntervalMs(agent);
  if (!intervalMs) return false;

  scheduleTick(agentId, intervalMs);
  return true;
}

/**
 * Stop heartbeat for an agent.
 */
export function stopHeartbeat(agentId: string): void {
  const timer = timers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(agentId);
  }
}

/**
 * Start heartbeats for all configured agents.
 * Called on gateway startup.
 */
export function startAllHeartbeats(): void {
  const config = loadConfig();
  for (const agent of config.agents) {
    startHeartbeat(agent.id);
  }
}

/**
 * Stop all heartbeat timers.
 * Called on gateway shutdown.
 */
export function stopAllHeartbeats(): void {
  for (const [agentId, timer] of timers) {
    clearTimeout(timer);
  }
  timers.clear();
}

/**
 * Get list of agents with active heartbeat timers.
 */
export function getActiveHeartbeats(): string[] {
  return Array.from(timers.keys());
}
