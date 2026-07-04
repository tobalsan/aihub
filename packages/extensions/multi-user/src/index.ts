import {
  MultiUserConfigSchema,
  type AgentConfig,
  type Extension,
  type ExtensionContext,
  type ExtensionLogger,
} from "@aihub/shared";
import type { Hono } from "hono";
import type Database from "better-sqlite3";
import { initializeMultiUserDatabase } from "./db.js";
import { createMultiUserAuth } from "./auth.js";
import { registerMultiUserRoutes } from "./routes.js";
import {
  createAgentAssignmentStore,
  type AgentAssignmentStore,
} from "./assignments.js";
import { createTeamStore, type TeamStore } from "./teams.js";
import {
  createMembershipStore,
  type MembershipStore,
} from "./membership.js";

export type MultiUserRuntime = {
  auth: Awaited<ReturnType<typeof createMultiUserAuth>>;
  db: Database.Database;
  assignments: AgentAssignmentStore;
  teams: TeamStore;
  membership: MembershipStore;
  getAgent: ExtensionContext["getAgent"];
  logger: ExtensionLogger;
};

let runtime: MultiUserRuntime | null = null;

export function getMultiUserRuntime(): MultiUserRuntime | null {
  return runtime;
}

const STAFF_ROLES = ["admin", "superadmin"];

function hasAdminRole(role: string | string[] | null | undefined): boolean {
  if (Array.isArray(role)) return role.some((r) => STAFF_ROLES.includes(r));
  return typeof role === "string" && STAFF_ROLES.includes(role);
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

export {
  FORWARDED_AUTH_CONTEXT_HEADER,
  createAuthMiddleware,
  forwardAuthContextToRequest,
  getForwardedAuthContext,
  getRequestAuthContext,
  hasActiveImpersonation,
  hasAgentAccess,
  requireAdmin,
  requireSuperadmin,
  requireAgentAccess,
  requireNotImpersonating,
  validateWebSocketRequest,
} from "./middleware.js";
export type { RequestAuthContext } from "./middleware.js";
export {
  getUserDataDir,
  getUserHistoryDir,
  getUserSessionsPath,
} from "./isolation.js";
export { initializeMultiUserDatabase, getAuthDbPath } from "./db.js";
export { createMultiUserAuth } from "./auth.js";
export type { MultiUserAuth } from "./auth.js";
export {
  createTeamStore,
  DEFAULT_TEAM_COLOR,
  DEFAULT_TEAM_ICON,
  DuplicateTeamNameError,
  TeamNotFoundError,
} from "./teams.js";
export type {
  Team,
  TeamStore,
  CreateTeamInput,
  UpdateTeamInput,
  DeleteTeamResult,
} from "./teams.js";
export { createMembershipStore } from "./membership.js";
export type { MembershipStore, TeamMember } from "./membership.js";

export const multiUserExtension: Extension = {
  id: "multiUser",
  displayName: "Multi-User Auth",
  description: "OAuth authentication, sessions, and per-user agent access control",
  dependencies: [],
  configSchema: MultiUserConfigSchema,
  routePrefixes: [
    "/api/auth",
    "/api/me",
    "/api/admin",
    "/api/teams",
    "/api/impersonation",
  ],
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
  async start(ctx: ExtensionContext) {
    const config = ctx.getConfig().extensions?.multiUser;
    if (!config?.enabled) {
      throw new Error("multiUser config missing or disabled");
    }

    const db = initializeMultiUserDatabase(ctx.getDataDir());
    const auth = await createMultiUserAuth(ctx.getConfig(), config, db);
    const assignments = createAgentAssignmentStore(db);
    const membership = createMembershipStore(db);
    const teams = createTeamStore(db, membership);
    runtime = {
      auth,
      db,
      assignments,
      teams,
      membership,
      getAgent: ctx.getAgent,
      logger: ctx.logger,
    };
  },
  async stop() {
    runtime?.db.close();
    runtime = null;
  },
  capabilities() {
    return runtime ? ["multi-user"] : [];
  },
};
