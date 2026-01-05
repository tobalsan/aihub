import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SessionEntry = {
  sessionId: string;
  updatedAt: number;
};

export const DEFAULT_MAIN_KEY = "main";
export const DEFAULT_IDLE_MINUTES = 60;
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
    idleMinutes = DEFAULT_IDLE_MINUTES,
    resetTriggers = DEFAULT_RESET_TRIGGERS,
  } = params;

  ensureLoaded();

  const storeKey = `${agentId}:${sessionKey}`;
  const entry = store[storeKey];
  const now = Date.now();
  const idleMs = idleMinutes * 60_000;
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
  if (shouldCreateNew) {
    sessionId = crypto.randomUUID();
  } else {
    sessionId = entry.sessionId;
  }

  // Update store
  store[storeKey] = { sessionId, updatedAt: now };
  await save();

  return {
    sessionId,
    message: strippedMessage,
    isNew: shouldCreateNew,
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
