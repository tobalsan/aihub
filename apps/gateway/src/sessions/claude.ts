import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Persistent mapping of agentId+sessionId -> Claude SDK session_id.
 * Used to resume Claude SDK sessions across gateway restarts.
 */

const STORE_PATH = path.join(os.homedir(), ".aihub", "claude-sessions.json");

let store: Record<string, string> = {};
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
 */
export function getClaudeSessionId(
  agentId: string,
  sessionId: string
): string | undefined {
  ensureLoaded();
  return store[makeKey(agentId, sessionId)];
}

/**
 * Save Claude SDK session_id for an agent session.
 */
export async function setClaudeSessionId(
  agentId: string,
  sessionId: string,
  claudeSessionId: string
): Promise<void> {
  ensureLoaded();
  store[makeKey(agentId, sessionId)] = claudeSessionId;
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
