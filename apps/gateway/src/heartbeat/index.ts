export {
  // Core functions
  runHeartbeat,
  startHeartbeat,
  stopHeartbeat,
  startAllHeartbeats,
  stopAllHeartbeats,
  // Global toggle
  setHeartbeatsEnabled,
  areHeartbeatsEnabled,
  // Query functions
  isHeartbeatEnabled,
  getHeartbeatIntervalMs,
  getActiveHeartbeats,
  // Events
  onHeartbeatEvent,
  // Utilities (exported for testing)
  parseDurationMs,
  stripHeartbeatToken,
  containsHeartbeatToken,
  evaluateHeartbeatReply,
} from "./runner.js";
