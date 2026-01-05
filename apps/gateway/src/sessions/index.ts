export {
  resolveSessionId,
  getSessionEntry,
  DEFAULT_MAIN_KEY,
  DEFAULT_IDLE_MINUTES,
  DEFAULT_RESET_TRIGGERS,
  type SessionEntry,
  type ResolveSessionParams,
  type ResolveSessionResult,
} from "./store.js";

export {
  getClaudeSessionId,
  setClaudeSessionId,
  clearClaudeSessionId,
} from "./claude.js";
