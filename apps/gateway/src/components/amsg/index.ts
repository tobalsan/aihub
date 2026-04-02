import { AmsgComponentConfigSchema, type Component } from "@aihub/shared";
import { startAmsgWatcher, stopAmsgWatcher } from "../../amsg/index.js";

const amsgComponent: Component = {
  id: "amsg",
  displayName: "Amsg",
  dependencies: [],
  requiredSecrets: [],
  validateConfig(raw) {
    const result = AmsgComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start() {
    startAmsgWatcher();
  },
  async stop() {
    stopAmsgWatcher();
  },
  capabilities() {
    return ["amsg"];
  },
};

export { amsgComponent };
