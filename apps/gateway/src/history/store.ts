import fs from "node:fs/promises";
import path from "node:path";
import type {
  FullHistoryMessage,
  SimpleHistoryMessage,
  ContentBlock,
  ModelUsage,
} from "@aihub/shared";
import type { HistoryEvent } from "../sdk/types.js";
import { CONFIG_DIR } from "../config/index.js";
import { getClaudeSessionIdForSession } from "../sessions/claude.js";
import {
  getSessionCreatedAt,
  formatSessionTimestamp,
} from "../sessions/store.js";

const HISTORY_DIR = path.join(CONFIG_DIR, "history");

async function ensureHistoryDir() {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
}

const legacyFileName = (agentId: string, sessionId: string) =>
  `${agentId}-${sessionId}.jsonl`;

const timestampedFileName = (timestamp: number, agentId: string, sessionId: string) =>
  `${formatSessionTimestamp(timestamp)}_${agentId}-${sessionId}.jsonl`;

/**
 * Find existing timestamped file by scanning directory for pattern *_{agentId}-{sessionId}.jsonl
 * Returns the most recent (lexicographically last) if multiple exist
 */
async function findTimestampedFile(dir: string, agentId: string, sessionId: string): Promise<string | null> {
  const suffix = `_${agentId}-${sessionId}.jsonl`;
  try {
    const files = await fs.readdir(dir);
    const matches = files.filter((f) => f.endsWith(suffix)).sort();
    const latest = matches.at(-1);
    return latest ? path.join(dir, latest) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve history file path with timestamp prefix support.
 * - For existing files: checks known timestamped path, then scans for any timestamped file, then legacy
 * - For new files: always creates timestamped filename (uses createdAt or defaults to now)
 */
async function resolveHistoryFile(agentId: string, sessionId: string): Promise<string> {
  await ensureHistoryDir();
  const createdAt = getSessionCreatedAt(sessionId);

  // Try exact timestamped file first (if we have createdAt)
  if (createdAt) {
    const timestampedPath = path.join(HISTORY_DIR, timestampedFileName(createdAt, agentId, sessionId));
    try {
      await fs.access(timestampedPath);
      return timestampedPath;
    } catch {
      // Exact timestamped file doesn't exist
    }
  }

  // Scan for any existing timestamped file (handles missing createdAt in sessions.json)
  const existingTimestamped = await findTimestampedFile(HISTORY_DIR, agentId, sessionId);
  if (existingTimestamped) {
    return existingTimestamped;
  }

  // Try legacy file (backwards compat)
  const legacyPath = path.join(HISTORY_DIR, legacyFileName(agentId, sessionId));
  try {
    await fs.access(legacyPath);
    return legacyPath;
  } catch {
    // Neither exists, create new timestamped file
  }

  // New file: always use timestamped format (use createdAt or default to now)
  const timestamp = createdAt ?? Date.now();
  return path.join(HISTORY_DIR, timestampedFileName(timestamp, agentId, sessionId));
}

// JSONL entry format for canonical history
type UserHistoryEntry = {
  type: "history";
  agentId: string;
  sessionId: string;
  timestamp: number;
  role: "user";
  content: ContentBlock[];
};

type AssistantHistoryEntry = {
  type: "history";
  agentId: string;
  sessionId: string;
  timestamp: number;
  role: "assistant";
  content: ContentBlock[];
  meta?: { provider?: string; model?: string; api?: string; usage?: ModelUsage; stopReason?: string };
};

type ToolResultHistoryEntry = {
  type: "history";
  agentId: string;
  sessionId: string;
  timestamp: number;
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  isError: boolean;
  details?: { diff?: string };
};

type HistoryEntry = UserHistoryEntry | AssistantHistoryEntry | ToolResultHistoryEntry;

// Meta entry for session-level metadata (e.g., thinkingLevel changes)
type MetaEntry = {
  type: "meta";
  key: string;
  value: unknown;
  timestamp: number;
};

/**
 * Append a raw history entry to the canonical store
 */
async function appendRawEntry(
  agentId: string,
  sessionId: string,
  entry: Record<string, unknown>
): Promise<void> {
  const file = await resolveHistoryFile(agentId, sessionId);
  const line = JSON.stringify({ type: "history", agentId, sessionId, ...entry }) + "\n";
  await fs.appendFile(file, line, "utf-8");
}

/**
 * Append a meta entry to the session's JSONL file
 * Format: {"type":"meta","key":"thinkingLevel","value":"medium","timestamp":...}
 */
export async function appendSessionMeta(
  agentId: string,
  sessionId: string,
  key: string,
  value: unknown
): Promise<void> {
  const file = await resolveHistoryFile(agentId, sessionId);
  const entry: MetaEntry = { type: "meta", key, value, timestamp: Date.now() };
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(file, line, "utf-8");
}

/**
 * Turn buffer for accumulating history events into messages
 * Buffers everything synchronously, then flushes to disk in correct order
 */
export type TurnBuffer = {
  userText: string | null;
  userTimestamp: number;
  thinkingText: string;
  assistantText: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
  toolResults: Array<{
    id: string;
    name: string;
    content: string;
    isError: boolean;
    details?: { diff?: string };
    timestamp: number;
  }>;
  meta?: {
    provider?: string;
    model?: string;
    api?: string;
    usage?: ModelUsage;
    stopReason?: string;
  };
  startTimestamp: number;
  assistantStarted: boolean;
};

export function createTurnBuffer(): TurnBuffer {
  return {
    userText: null,
    userTimestamp: Date.now(),
    thinkingText: "",
    assistantText: "",
    toolCalls: [],
    toolResults: [],
    startTimestamp: Date.now(),
    assistantStarted: false,
  };
}

/**
 * Flush turn buffer to history store in correct order:
 * 1. User message
 * 2. Assistant message (thinking, tool calls, text)
 * 3. Tool results
 */
export async function flushTurnBuffer(
  agentId: string,
  sessionId: string,
  buffer: TurnBuffer
): Promise<void> {
  // 1. User message
  if (buffer.userText) {
    await appendRawEntry(agentId, sessionId, {
      role: "user",
      content: [{ type: "text", text: buffer.userText }],
      timestamp: buffer.userTimestamp,
    });
  }

  // 2. Assistant message
  const content: ContentBlock[] = [];
  if (buffer.thinkingText) {
    content.push({ type: "thinking", thinking: buffer.thinkingText });
  }
  for (const tc of buffer.toolCalls) {
    content.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.args });
  }
  if (buffer.assistantText) {
    content.push({ type: "text", text: buffer.assistantText });
  }

  if (content.length > 0) {
    await appendRawEntry(agentId, sessionId, {
      role: "assistant",
      content,
      meta: buffer.meta,
      timestamp: buffer.startTimestamp,
    });
  }

  // 3. Tool results (after assistant message)
  for (const tr of buffer.toolResults) {
    await appendRawEntry(agentId, sessionId, {
      role: "toolResult",
      toolCallId: tr.id,
      toolName: tr.name,
      content: [{ type: "text", text: tr.content }],
      isError: tr.isError,
      details: tr.details,
      timestamp: tr.timestamp,
    });
  }
}

/**
 * Accumulate a history event into the turn buffer (sync, no I/O)
 */
export function bufferHistoryEvent(buffer: TurnBuffer, event: HistoryEvent): void {
  switch (event.type) {
    case "user":
      buffer.userText = event.text;
      buffer.userTimestamp = event.timestamp;
      break;
    case "assistant_text":
      if (!buffer.assistantStarted) {
        buffer.assistantStarted = true;
        buffer.startTimestamp = event.timestamp;
      }
      buffer.assistantText += event.text;
      break;
    case "assistant_thinking":
      if (!buffer.assistantStarted) {
        buffer.assistantStarted = true;
        buffer.startTimestamp = event.timestamp;
      }
      buffer.thinkingText += event.text;
      break;
    case "tool_call":
      if (!buffer.assistantStarted) {
        buffer.assistantStarted = true;
        buffer.startTimestamp = event.timestamp;
      }
      buffer.toolCalls.push({ id: event.id, name: event.name, args: event.args });
      break;
    case "tool_result":
      if (!buffer.assistantStarted) {
        buffer.assistantStarted = true;
        buffer.startTimestamp = event.timestamp;
      }
      buffer.toolResults.push({
        id: event.id,
        name: event.name,
        content: event.content,
        isError: event.isError,
        details: event.details,
        timestamp: event.timestamp,
      });
      break;
    case "turn_end":
      break;
    case "meta":
      if (!buffer.assistantStarted) {
        buffer.assistantStarted = true;
        buffer.startTimestamp = event.timestamp;
      }
      buffer.meta = {
        provider: event.provider,
        model: event.model,
        api: event.api,
        usage: event.usage,
        stopReason: event.stopReason,
      };
      break;
  }
}

/**
 * Load simple history (text only) from canonical store
 */
export async function getSimpleHistory(
  agentId: string,
  sessionId: string
): Promise<SimpleHistoryMessage[]> {
  const file = await resolveHistoryFile(agentId, sessionId);
  const messages: SimpleHistoryMessage[] = [];

  try {
    const content = await fs.readFile(file, "utf-8");
    const lines = content.trim().split("\n");

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (entry.type !== "history") continue;

        if (entry.role === "user" || entry.role === "assistant") {
          const text = entry.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          if (text) {
            messages.push({ role: entry.role, content: text, timestamp: entry.timestamp });
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist
  }

  return messages;
}

/**
 * Load full history from canonical store
 */
export async function getFullHistory(
  agentId: string,
  sessionId: string
): Promise<FullHistoryMessage[]> {
  const file = await resolveHistoryFile(agentId, sessionId);
  const messages: FullHistoryMessage[] = [];

  try {
    const content = await fs.readFile(file, "utf-8");
    const lines = content.trim().split("\n");

    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (entry.type !== "history") continue;

        if (entry.role === "user") {
          messages.push({
            role: "user",
            content: entry.content,
            timestamp: entry.timestamp,
          });
        } else if (entry.role === "assistant") {
          messages.push({
            role: "assistant",
            content: entry.content,
            timestamp: entry.timestamp,
            meta: entry.meta,
          });
        } else if (entry.role === "toolResult") {
          messages.push({
            role: "toolResult",
            toolCallId: entry.toolCallId,
            toolName: entry.toolName,
            content: entry.content,
            isError: entry.isError,
            details: entry.details,
            timestamp: entry.timestamp,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist
  }

  return messages;
}

/**
 * Check if canonical history exists for a session
 */
export async function hasCanonicalHistory(
  agentId: string,
  sessionId: string
): Promise<boolean> {
  const file = await resolveHistoryFile(agentId, sessionId);
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const PI_SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
const CLAUDE_SESSIONS_DIR = path.join(CONFIG_DIR, "sessions", "projects");

/**
 * Resolve Pi session file path (supports both timestamped and legacy formats)
 */
async function resolvePiSessionFile(agentId: string, sessionId: string): Promise<string | null> {
  const createdAt = getSessionCreatedAt(sessionId);

  // Try exact timestamped file first (if we have createdAt)
  if (createdAt) {
    const timestampedPath = path.join(PI_SESSIONS_DIR, timestampedFileName(createdAt, agentId, sessionId));
    try {
      await fs.access(timestampedPath);
      return timestampedPath;
    } catch {
      // Exact timestamped file doesn't exist
    }
  }

  // Scan for any existing timestamped file
  const existingTimestamped = await findTimestampedFile(PI_SESSIONS_DIR, agentId, sessionId);
  if (existingTimestamped) {
    return existingTimestamped;
  }

  // Try legacy file
  const legacyPath = path.join(PI_SESSIONS_DIR, legacyFileName(agentId, sessionId));
  try {
    await fs.access(legacyPath);
    return legacyPath;
  } catch {
    return null;
  }
}

async function resolveClaudeSessionFile(
  agentId: string,
  sessionId: string
): Promise<string | null> {
  const claudeSessionId = getClaudeSessionIdForSession(agentId, sessionId);
  if (!claudeSessionId) return null;

  try {
    const entries = await fs.readdir(CLAUDE_SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(CLAUDE_SESSIONS_DIR, entry.name, `${claudeSessionId}.jsonl`);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // ignore
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function backfillFromClaudeSession(
  agentId: string,
  sessionId: string
): Promise<boolean> {
  if (await hasCanonicalHistory(agentId, sessionId)) return false;

  const claudeFile = await resolveClaudeSessionFile(agentId, sessionId);
  if (!claudeFile) return false;

  let content: string;
  try {
    content = await fs.readFile(claudeFile, "utf-8");
  } catch {
    return false;
  }

  await ensureHistoryDir();
  const lines = content.trim().split("\n");
  for (const line of lines) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type === "user") {
        const message = entry.message as Record<string, unknown> | undefined;
        const role = message?.role;
        if (role !== "user") continue;
        const rawContent = message?.content;
        const text =
          typeof rawContent === "string"
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent
                  .map((item) => {
                    if (!item || typeof item !== "object") return "";
                    const block = item as Record<string, unknown>;
                    if (block.type === "text" && typeof block.text === "string") {
                      return block.text;
                    }
                    if (block.type === "tool_result") {
                      if (typeof block.content === "string") return block.content;
                      if (Array.isArray(block.content)) return extractText(block.content);
                    }
                    return "";
                  })
                  .filter(Boolean)
                  .join("\n")
              : "";
        if (!text) continue;
        const ts = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Date.now();
        await appendRawEntry(agentId, sessionId, {
          role: "user",
          content: [{ type: "text", text }],
          timestamp: Number.isNaN(ts) ? Date.now() : ts,
        });
      } else if (entry.type === "assistant") {
        const message = entry.message as Record<string, unknown> | undefined;
        const role = message?.role;
        if (role !== "assistant") continue;
        const content = message?.content;
        const blocks: ContentBlock[] = [];
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const item = block as Record<string, unknown>;
            if (item.type === "text" && typeof item.text === "string") {
              blocks.push({ type: "text", text: item.text });
            } else if (item.type === "thinking" && typeof item.thinking === "string") {
              blocks.push({ type: "thinking", thinking: item.thinking });
            } else if (item.type === "tool_use" && typeof item.id === "string" && typeof item.name === "string") {
              blocks.push({ type: "toolCall", id: item.id, name: item.name, arguments: item.input });
            }
          }
        }
        if (blocks.length === 0) continue;
        const ts = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Date.now();
        const usage = (message?.usage as Record<string, unknown> | undefined) ?? undefined;
        const usageMapped =
          usage && typeof usage === "object"
            ? {
                input: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
                output: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
                cacheRead:
                  typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined,
                cacheWrite:
                  typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : undefined,
                totalTokens:
                  (typeof usage.input_tokens === "number" ? usage.input_tokens : 0) +
                  (typeof usage.output_tokens === "number" ? usage.output_tokens : 0),
              }
            : undefined;
        await appendRawEntry(agentId, sessionId, {
          role: "assistant",
          content: blocks,
          meta: {
            provider: "anthropic",
            model: typeof message?.model === "string" ? message.model : undefined,
            usage: usageMapped,
            stopReason: typeof message?.stop_reason === "string" ? message.stop_reason : undefined,
          },
          timestamp: Number.isNaN(ts) ? Date.now() : ts,
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  return true;
}

/**
 * Backfill canonical history from Pi session file (one-time migration)
 * Returns true if backfill was performed, false if not needed
 */
export async function backfillFromPiSession(
  agentId: string,
  sessionId: string
): Promise<boolean> {
  // Skip if canonical already exists or Pi session doesn't exist
  if (await hasCanonicalHistory(agentId, sessionId)) return false;

  const piFile = await resolvePiSessionFile(agentId, sessionId);
  if (!piFile) return false;

  let content: string;
  try {
    content = await fs.readFile(piFile, "utf-8");
  } catch {
    return false;
  }

  await ensureHistoryDir();
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
        const text = extractText(rawContent);
        if (text) {
          await appendRawEntry(agentId, sessionId, {
            role: "user",
            content: [{ type: "text", text }],
            timestamp,
          });
        }
      } else if (msg.role === "assistant") {
        const blocks = convertPiContent(rawContent);
        if (blocks.length > 0) {
          await appendRawEntry(agentId, sessionId, {
            role: "assistant",
            content: blocks,
            meta: {
              api: msg.api as string | undefined,
              provider: msg.provider as string | undefined,
              model: msg.model as string | undefined,
              usage: msg.usage as ModelUsage | undefined,
              stopReason: msg.stopReason as string | undefined,
            },
            timestamp,
          });
        }
      } else if (msg.role === "toolResult") {
        const text = extractText(rawContent);
        const details = msg.details as Record<string, unknown> | undefined;
        await appendRawEntry(agentId, sessionId, {
          role: "toolResult",
          toolCallId: msg.toolCallId as string,
          toolName: msg.toolName as string,
          content: [{ type: "text", text: text || "" }],
          isError: (msg.isError as boolean) ?? false,
          details: details?.diff ? { diff: details.diff as string } : undefined,
          timestamp,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return true;
}

export async function backfillFromClaudeSessionIfNeeded(
  agentId: string,
  sessionId: string
): Promise<boolean> {
  return backfillFromClaudeSession(agentId, sessionId);
}

function extractText(content: unknown[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } => {
      if (!c || typeof c !== "object") return false;
      const obj = c as Record<string, unknown>;
      return obj.type === "text" && typeof obj.text === "string";
    })
    .map((c) => c.text)
    .join("\n");
}

function convertPiContent(content: unknown[]): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const c of content) {
    const block = c as Record<string, unknown>;
    if (block.type === "thinking" && typeof block.thinking === "string") {
      blocks.push({ type: "thinking", thinking: block.thinking });
    } else if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "toolCall" && typeof block.id === "string") {
      blocks.push({
        type: "toolCall",
        id: block.id,
        name: block.name as string,
        arguments: block.arguments,
      });
    }
  }
  return blocks;
}
