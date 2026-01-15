import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ThinkLevel } from "@aihub/shared";
import { loadConfig } from "../config/index.js";

export type SessionEntry = {
  sessionId: string;
  updatedAt: number;
  createdAt?: number;
  thinkLevel?: ThinkLevel;
};

export const DEFAULT_MAIN_KEY = "main";
export const DEFAULT_IDLE_MINUTES = 360;
export const DEFAULT_RESET_TRIGGERS = ["/new", "/reset"];
export const DEFAULT_ABORT_TRIGGERS = ["/abort"];

/**
 * Check if message is an abort trigger.
 * Matches exact trigger or trigger + " " prefix.
 */
export function isAbortTrigger(
  message: string,
  triggers = DEFAULT_ABORT_TRIGGERS
): boolean {
  const trimmed = message.trim();
  for (const trigger of triggers) {
    if (!trigger) continue;
    if (trimmed === trigger || trimmed.startsWith(trigger + " ")) {
      return true;
    }
  }
  return false;
}

const STORE_PATH = path.join(os.homedir(), ".aihub", "sessions.json");

let store: Record<string, SessionEntry> = {};
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      store = parsed;
    }
  } catch {
    store = {};
  }
  loaded = true;
}

async function save() {
  await fs.promises.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const json = JSON.stringify(store, null, 2);
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, json, "utf-8");
  await fs.promises.rename(tmp, STORE_PATH);
}

export type ResolveSessionParams = {
  agentId: string;
  sessionKey?: string;
  message: string;
  idleMinutes?: number;
  resetTriggers?: string[];
};

export type ResolveSessionResult = {
  sessionId: string;
  message: string; // potentially stripped of reset trigger
  isNew: boolean;
  createdAt: number;
};

/**
 * Resolve a sessionId from a sessionKey with idle timeout and reset triggers.
 * Returns the sessionId to use and the message (stripped if it was a reset trigger).
 */
export async function resolveSessionId(
  params: ResolveSessionParams
): Promise<ResolveSessionResult> {
  const {
    agentId,
    sessionKey = DEFAULT_MAIN_KEY,
    message,
    idleMinutes,
    resetTriggers = DEFAULT_RESET_TRIGGERS,
  } = params;

  ensureLoaded();

  const config = loadConfig();
  const configuredIdleMinutes = config.sessions?.idleMinutes;
  const resolvedIdleMinutes =
    idleMinutes ?? configuredIdleMinutes ?? DEFAULT_IDLE_MINUTES;

  const storeKey = `${agentId}:${sessionKey}`;
  const entry = store[storeKey];
  const now = Date.now();
  const idleMs = resolvedIdleMinutes * 60_000;
  const trimmedMsg = message.trim();

  // Check for reset triggers
  let isReset = false;
  let strippedMessage = message;
  for (const trigger of resetTriggers) {
    if (!trigger) continue;
    if (trimmedMsg === trigger) {
      isReset = true;
      strippedMessage = "";
      break;
    }
    if (trimmedMsg.startsWith(trigger + " ")) {
      isReset = true;
      strippedMessage = trimmedMsg.slice(trigger.length + 1);
      break;
    }
  }

  // Determine if we should create a new session
  const isExpired = !entry || now - entry.updatedAt > idleMs;
  const shouldCreateNew = isReset || isExpired;

  let sessionId: string;
  let createdAt: number;
  if (shouldCreateNew) {
    sessionId = crypto.randomUUID();
    createdAt = now;
  } else {
    sessionId = entry.sessionId;
    createdAt = entry.createdAt ?? now; // fallback for legacy entries
  }

  // Update store
  store[storeKey] = { sessionId, updatedAt: now, createdAt };
  await save();

  return {
    sessionId,
    message: strippedMessage,
    isNew: shouldCreateNew,
    createdAt,
  };
}

/**
 * Get session entry without modifying it (for status checks)
 */
export function getSessionEntry(
  agentId: string,
  sessionKey: string
): SessionEntry | undefined {
  ensureLoaded();
  return store[`${agentId}:${sessionKey}`];
}

/**
 * Look up createdAt timestamp for a sessionId (searches all entries)
 * Returns undefined if not found
 */
export function getSessionCreatedAt(sessionId: string): number | undefined {
  ensureLoaded();
  for (const entry of Object.values(store)) {
    if (entry.sessionId === sessionId) {
      return entry.createdAt;
    }
  }
  return undefined;
}

/**
 * Format timestamp for session filename prefix
 * Format: 2026-01-08T14-19-25-394Z (ISO-like but filesystem safe)
 */
export function formatSessionTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number, len = 2) => n.toString().padStart(len, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}Z`;
}

/**
 * Get the thinkLevel for a session
 */
export function getSessionThinkLevel(
  agentId: string,
  sessionKey: string
): ThinkLevel | undefined {
  ensureLoaded();
  const storeKey = `${agentId}:${sessionKey}`;
  return store[storeKey]?.thinkLevel;
}

/**
 * Set the thinkLevel for a session.
 * Creates entry if it doesn't exist.
 */
export async function setSessionThinkLevel(
  agentId: string,
  sessionKey: string,
  level: ThinkLevel,
  sessionId?: string
): Promise<void> {
  ensureLoaded();
  const storeKey = `${agentId}:${sessionKey}`;
  const entry = store[storeKey];
  if (entry) {
    entry.thinkLevel = level;
  } else {
    // Create entry if missing (use provided sessionId or generate new)
    const now = Date.now();
    store[storeKey] = {
      sessionId: sessionId ?? crypto.randomUUID(),
      updatedAt: now,
      createdAt: now,
      thinkLevel: level,
    };
  }
  await save();
}
