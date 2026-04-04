import {
  MultiUserConfigSchema,
  type Component,
  type ComponentContext,
} from "@aihub/shared";
import type { Hono } from "hono";
import type Database from "better-sqlite3";
import { initializeMultiUserDatabase } from "./db.js";
import { createMultiUserAuth } from "./auth.js";
import { registerMultiUserRoutes } from "./routes.js";

export type MultiUserRuntime = {
  auth: Awaited<ReturnType<typeof createMultiUserAuth>>;
  db: Database.Database;
};

let runtime: MultiUserRuntime | null = null;

export function getMultiUserRuntime(): MultiUserRuntime | null {
  return runtime;
}

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
  registerRoutes(app: Hono) {
    registerMultiUserRoutes(app);
  },
  async start(ctx: ComponentContext) {
    const config = ctx.getConfig().multiUser;
    if (!config?.enabled) {
      throw new Error("multiUser config missing or disabled");
    }

    const db = initializeMultiUserDatabase();
    const auth = await createMultiUserAuth(ctx.getConfig(), config, db);
    runtime = { auth, db };
  },
  async stop() {
    runtime?.db.close();
    runtime = null;
  },
  capabilities() {
    return runtime ? ["multi-user"] : [];
  },
};
