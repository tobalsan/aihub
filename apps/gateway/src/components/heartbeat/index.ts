import { HeartbeatComponentConfigSchema, type Component } from "@aihub/shared";
import { startAllHeartbeats, stopAllHeartbeats } from "../../heartbeat/index.js";

const heartbeatComponent: Component = {
  id: "heartbeat",
  displayName: "Heartbeat",
  dependencies: ["scheduler"],
  requiredSecrets: [],
  validateConfig(raw) {
    const result = HeartbeatComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start() {
    startAllHeartbeats();
  },
  async stop() {
    stopAllHeartbeats();
  },
  capabilities() {
    return ["heartbeat"];
  },
};

export { heartbeatComponent };
