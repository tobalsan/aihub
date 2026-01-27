import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Persistent mapping of agentId+sessionId -> Claude SDK session info.
 * Used to resume Claude SDK sessions across gateway restarts.
 */

type ClaudeSessionEntry = {
  claudeSessionId: string;
  model: string;
};

const STORE_PATH = path.join(os.homedir(), ".aihub", "claude-sessions.json");

let store: Record<string, ClaudeSessionEntry | string> = {}; // string for backwards compat
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

function makeKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

/**
 * Get Claude SDK session_id for an agent session.
 * Only returns if model matches (session can't change models).
 */
export function getClaudeSessionId(
  agentId: string,
  sessionId: string,
  model: string
): string | undefined {
  ensureLoaded();
  const entry = store[makeKey(agentId, sessionId)];
  if (!entry) return undefined;
  // Backwards compat: old entries are just strings
  if (typeof entry === "string") return undefined; // Can't verify model, skip resume
  // Only resume if model matches
  if (entry.model !== model) return undefined;
  return entry.claudeSessionId;
}

/**
 * Get Claude SDK session_id without model verification.
 * Used for history backfill when model is not available.
 */
export function getClaudeSessionIdForSession(
  agentId: string,
  sessionId: string
): string | undefined {
  ensureLoaded();
  const entry = store[makeKey(agentId, sessionId)];
  if (!entry) return undefined;
  if (typeof entry === "string") return entry;
  return entry.claudeSessionId;
}

/**
 * Save Claude SDK session_id for an agent session.
 */
export async function setClaudeSessionId(
  agentId: string,
  sessionId: string,
  claudeSessionId: string,
  model: string
): Promise<void> {
  ensureLoaded();
  store[makeKey(agentId, sessionId)] = { claudeSessionId, model };
  await save();
}

/**
 * Clear Claude SDK session_id for an agent session.
 * Called when session is reset via /new or idle timeout.
 */
export async function clearClaudeSessionId(
  agentId: string,
  sessionId: string
): Promise<void> {
  ensureLoaded();
  const key = makeKey(agentId, sessionId);
  if (key in store) {
    delete store[key];
    await save();
  }
}
