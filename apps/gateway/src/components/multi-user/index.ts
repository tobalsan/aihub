import {
  MultiUserConfigSchema,
  type Component,
  type ComponentContext,
} from "@aihub/shared";
import type { Hono } from "hono";

let started = false;

export const multiUserComponent: Component = {
  id: "multiUser",
  displayName: "Multi-User Auth",
  dependencies: [],
  requiredSecrets: [],
  routePrefixes: ["/api/auth", "/api/me"],
  validateConfig(raw) {
    const result = MultiUserConfigSchema.safeParse(raw);
    return result.success
      ? { valid: true, errors: [] }
      : {
          valid: false,
          errors: result.error.issues.map((issue) => issue.message),
        };
  },
  registerRoutes(_app: Hono) {},
  async start(_ctx: ComponentContext) {
    started = true;
  },
  async stop() {
    started = false;
  },
  capabilities() {
    return started ? ["multi-user"] : [];
  },
};
