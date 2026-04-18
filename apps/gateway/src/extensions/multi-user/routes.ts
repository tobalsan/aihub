import type { Hono } from "hono";
import { getMultiUserRuntime } from "./index.js";
import { registerMultiUserAdminRoutes } from "./admin-routes.js";

function refreshApproval(
  user: Record<string, unknown>,
  db: import("better-sqlite3").Database
): void {
  if (user.approved === true) return;
  const row = db
    .prepare("SELECT approved, role FROM user WHERE id = ?")
    .get(String(user.id)) as
    | { approved: number; role: string | null }
    | undefined;
  if (row?.approved) {
    user.approved = true;
    if (row.role) user.role = row.role;
  }
}

function getRuntimeOrThrow() {
  const runtime = getMultiUserRuntime();
  if (!runtime) {
    throw new Error("multi-user runtime not initialized");
  }
  return runtime;
}

export function registerMultiUserRoutes(app: Hono): void {
  app.on(["GET", "POST"], "/auth/*", (c) => {
    const { auth } = getRuntimeOrThrow();
    const url = new URL(c.req.url);
    if (!url.pathname.startsWith("/api/")) {
      url.pathname = `/api${url.pathname}`;
    }
    return auth.handler(new Request(url, c.req.raw));
  });

  app.get("/me", async (c) => {
    const { auth, db, assignments } = getRuntimeOrThrow();
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ user: null, session: null }, 401);
    }

    const userId = String(session.user.id);
    const user = session.user as Record<string, unknown>;
    refreshApproval(user, db);
    return c.json({
      user: {
        id: userId,
        name: typeof user.name === "string" ? user.name : null,
        email: typeof user.email === "string" ? user.email : null,
        role:
          typeof user.role === "string" || Array.isArray(user.role)
            ? user.role
            : null,
        approved:
          typeof user.approved === "boolean"
            ? user.approved
            : user.approved === null
              ? null
              : null,
      },
      assignedAgentIds: assignments.getAssignmentsForUser(userId),
    });
  });

  registerMultiUserAdminRoutes(app);
}
