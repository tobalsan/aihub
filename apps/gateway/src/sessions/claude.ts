import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../config/index.js";
import { getUserClaudeSessionsPath } from "../components/multi-user/isolation.js";

/**
 * Persistent mapping of agentId+sessionId -> Claude SDK session info.
 * Used to resume Claude SDK sessions across gateway restarts.
 */

type ClaudeSessionEntry = {
  claudeSessionId: string;
  model: string;
};

type ClaudeStoreState = {
  store: Record<string, ClaudeSessionEntry | string>;
  loaded: boolean;
  loadPromise?: Promise<void>;
};

const storeStates = new Map<string, ClaudeStoreState>();

function getStorePath(userId?: string): string {
  return getUserClaudeSessionsPath(userId, CONFIG_DIR);
}

function getStoreState(userId?: string): ClaudeStoreState {
  const storePath = getStorePath(userId);
  let state = storeStates.get(storePath);
  if (!state) {
    state = { store: {}, loaded: false };
    storeStates.set(storePath, state);
  }
  return state;
}

async function ensureLoaded(userId?: string): Promise<void> {
  const state = getStoreState(userId);
  if (state.loaded) return;
  if (state.loadPromise) {
    await state.loadPromise;
    return;
  }

  const storePath = getStorePath(userId);
  state.loadPromise = (async () => {
    try {
      const raw = await fs.readFile(storePath, "utf-8");
      const parsed = JSON.parse(raw);
      state.store =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, ClaudeSessionEntry | string>)
          : {};
    } catch {
      state.store = {};
    } finally {
      state.loaded = true;
      state.loadPromise = undefined;
    }
  })();

  await state.loadPromise;
}

async function save(userId?: string) {
  const storePath = getStorePath(userId);
  const state = getStoreState(userId);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const json = JSON.stringify(state.store, null, 2);
  const tmp = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, json, "utf-8");
  await fs.rename(tmp, storePath);
}

function makeKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

/**
 * Get Claude SDK session_id for an agent session.
 * Only returns if model matches (session can't change models).
 */
export async function getClaudeSessionId(
  agentId: string,
  sessionId: string,
  model: string,
  userId?: string
): Promise<string | undefined> {
  await ensureLoaded(userId);
  const entry = getStoreState(userId).store[makeKey(agentId, sessionId)];
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
export async function getClaudeSessionIdForSession(
  agentId: string,
  sessionId: string,
  userId?: string
): Promise<string | undefined> {
  await ensureLoaded(userId);
  const entry = getStoreState(userId).store[makeKey(agentId, sessionId)];
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
  model: string,
  userId?: string
): Promise<void> {
  await ensureLoaded(userId);
  getStoreState(userId).store[makeKey(agentId, sessionId)] = {
    claudeSessionId,
    model,
  };
  await save(userId);
}

/**
 * Clear Claude SDK session_id for an agent session.
 * Called when session is reset via /new or idle timeout.
 */
export async function clearClaudeSessionId(
  agentId: string,
  sessionId: string,
  userId?: string
): Promise<void> {
  await ensureLoaded(userId);
  const state = getStoreState(userId);
  const key = makeKey(agentId, sessionId);
  if (key in state.store) {
    delete state.store[key];
    await save(userId);
  }
}
