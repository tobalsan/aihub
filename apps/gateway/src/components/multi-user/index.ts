import {
  MultiUserConfigSchema,
  type Component,
  type ComponentContext,
} from "@aihub/shared";
import type { Hono } from "hono";
import type Database from "better-sqlite3";
import type { AgentConfig } from "@aihub/shared";
import { initializeMultiUserDatabase } from "./db.js";
import { createMultiUserAuth } from "./auth.js";
import { registerMultiUserRoutes } from "./routes.js";
import {
  createAgentAssignmentStore,
  type AgentAssignmentStore,
} from "./assignments.js";

export type MultiUserRuntime = {
  auth: Awaited<ReturnType<typeof createMultiUserAuth>>;
  db: Database.Database;
  assignments: AgentAssignmentStore;
};

let runtime: MultiUserRuntime | null = null;

export function getMultiUserRuntime(): MultiUserRuntime | null {
  return runtime;
}

function hasAdminRole(role: string | string[] | null | undefined): boolean {
  if (Array.isArray(role)) return role.includes("admin");
  return role === "admin";
}

export function getAgentFilter(
  userId: string,
  role: string | string[] | null | undefined
): <T extends Pick<AgentConfig, "id">>(agents: T[]) => T[] {
  return (agents) => {
    const activeRuntime = getMultiUserRuntime();
    if (!activeRuntime || hasAdminRole(role)) return agents;
    const allowedAgentIds = new Set(
      activeRuntime.assignments.getAssignmentsForUser(userId)
    );
    return agents.filter((agent) => allowedAgentIds.has(agent.id));
  };
}

export const multiUserComponent: Component = {
  id: "multiUser",
  displayName: "Multi-User Auth",
  dependencies: [],
  requiredSecrets: [],
  routePrefixes: ["/api/auth", "/api/me", "/api/admin"],
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
    const assignments = createAgentAssignmentStore(db);
    runtime = { auth, db, assignments };
  },
  async stop() {
    runtime?.db.close();
    runtime = null;
  },
  capabilities() {
    return runtime ? ["multi-user"] : [];
  },
};
