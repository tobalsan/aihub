import type { Context, MiddlewareHandler } from "hono";
import { getMultiUserRuntime } from "./index.js";

export const FORWARDED_AUTH_CONTEXT_HEADER = "x-aihub-auth-context";

export type RequestAuthContext = {
  user: {
    id: string;
    email?: string;
    name?: string;
    image?: string | null;
    role?: string | string[] | null;
    approved?: boolean | null;
  };
  session: {
    id: string;
    userId: string;
    expiresAt?: string;
  };
};

const REQUEST_AUTH_CONTEXT_KEY = "multiUserAuthContext";

function normalizeAuthContext(session: {
  user: Record<string, unknown>;
  session: Record<string, unknown>;
}): RequestAuthContext {
  return {
    user: {
      id: String(session.user.id),
      email:
        typeof session.user.email === "string" ? session.user.email : undefined,
      name:
        typeof session.user.name === "string" ? session.user.name : undefined,
      image:
        typeof session.user.image === "string" || session.user.image === null
          ? (session.user.image as string | null)
          : undefined,
      role:
        typeof session.user.role === "string" ||
        Array.isArray(session.user.role)
          ? (session.user.role as string | string[])
          : undefined,
      approved:
        typeof session.user.approved === "boolean"
          ? session.user.approved
          : session.user.approved === null
            ? null
            : undefined,
    },
    session: {
      id: String(session.session.id),
      userId: String(session.session.userId),
      expiresAt:
        session.session.expiresAt instanceof Date
          ? session.session.expiresAt.toISOString()
          : typeof session.session.expiresAt === "string"
            ? session.session.expiresAt
            : undefined,
    },
  };
}

export function hasAdminRole(authContext: RequestAuthContext): boolean {
  const { role } = authContext.user;
  if (Array.isArray(role)) return role.includes("admin");
  return role === "admin";
}

function isApproved(authContext: RequestAuthContext): boolean {
  return authContext.user.approved === true || hasAdminRole(authContext);
}

/**
 * When the cookie-cached session says `approved: false`, check the DB
 * directly so newly-approved users don't have to wait for the cache to
 * expire.  Approved users still benefit from the full cookie cache TTL.
 */
function refreshApprovalFromDb(authContext: RequestAuthContext): void {
  if (isApproved(authContext)) return;

  const runtime = getMultiUserRuntime();
  if (!runtime?.db) return;

  const row = runtime.db
    .prepare("SELECT approved, role FROM user WHERE id = ?")
    .get(authContext.user.id) as
    | { approved: number; role: string | null }
    | undefined;

  if (row?.approved) {
    authContext.user.approved = true;
    if (row.role) authContext.user.role = row.role;
  }
}

function encodeAuthContext(authContext: RequestAuthContext): string {
  return Buffer.from(JSON.stringify(authContext), "utf-8").toString(
    "base64url"
  );
}

function decodeAuthContext(value: string): RequestAuthContext | null {
  try {
    return JSON.parse(
      Buffer.from(value, "base64url").toString("utf-8")
    ) as RequestAuthContext;
  } catch {
    return null;
  }
}

export function getRequestAuthContext(c: Context): RequestAuthContext | null {
  const authContext = c.get(REQUEST_AUTH_CONTEXT_KEY);
  return (authContext as RequestAuthContext | null | undefined) ?? null;
}

export function getForwardedAuthContext(
  headers: Headers
): RequestAuthContext | null {
  const encoded = headers.get(FORWARDED_AUTH_CONTEXT_HEADER);
  if (!encoded) return null;
  return decodeAuthContext(encoded);
}

export function forwardAuthContextToRequest(
  request: Request,
  authContext: RequestAuthContext | null
): Request {
  if (authContext) {
    request.headers.set(
      FORWARDED_AUTH_CONTEXT_HEADER,
      encodeAuthContext(authContext)
    );
  } else {
    request.headers.delete(FORWARDED_AUTH_CONTEXT_HEADER);
  }
  return request;
}

function shouldSkipAuth(path: string): boolean {
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return true;
  if (path === "/api/capabilities") return true;
  if (path === "/api/branding/logo") return true;
  if (path === "/api/theme.css") return true;
  return false;
}

async function getValidatedAuthContext(
  headers: Headers
): Promise<RequestAuthContext | null> {
  const runtime = getMultiUserRuntime();
  if (!runtime) return null;

  const session = await runtime.auth.api.getSession({ headers });
  if (!session) return null;

  const authContext = normalizeAuthContext(session);
  refreshApprovalFromDb(authContext);
  if (!isApproved(authContext)) return null;
  return authContext;
}

export const createAuthMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    if (shouldSkipAuth(c.req.path)) {
      await next();
      return;
    }

    const runtime = getMultiUserRuntime();
    if (!runtime) {
      await next();
      return;
    }

    const session = await runtime.auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const authContext = normalizeAuthContext(session);
    refreshApprovalFromDb(authContext);
    if (!isApproved(authContext)) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.set(REQUEST_AUTH_CONTEXT_KEY, authContext);
    await next();
  };
};

export const requireAdmin = (): MiddlewareHandler => {
  return async (c, next) => {
    if (!getMultiUserRuntime()) {
      await next();
      return;
    }

    let authContext = getRequestAuthContext(c);
    if (!authContext) {
      // When running inside the api sub-app, the main app forwards the
      // auth context via header instead of Hono's context store.
      authContext = getForwardedAuthContext(c.req.raw.headers);
      if (authContext) {
        c.set(REQUEST_AUTH_CONTEXT_KEY, authContext);
      }
    }
    if (!authContext) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!hasAdminRole(authContext)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  };
};

export async function hasAgentAccess(
  authContext: RequestAuthContext | null,
  agentId: string
): Promise<boolean> {
  if (!authContext) return true;
  if (hasAdminRole(authContext)) return true;

  const runtime = getMultiUserRuntime();
  if (!runtime) return true;

  return runtime.assignments
    .getAssignmentsForUser(authContext.user.id)
    .includes(agentId);
}

export const requireAgentAccess = (agentIdParam = "id"): MiddlewareHandler => {
  return async (c, next) => {
    if (!getMultiUserRuntime()) {
      await next();
      return;
    }

    const authContext = getRequestAuthContext(c);
    if (!authContext) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const agentId = c.req.param(agentIdParam);
    if (!agentId) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!(await hasAgentAccess(authContext, agentId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    await next();
  };
};

export async function validateWebSocketRequest(
  request: Request
): Promise<RequestAuthContext | null> {
  return getValidatedAuthContext(request.headers);
}
