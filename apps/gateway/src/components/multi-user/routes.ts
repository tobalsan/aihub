import type { Hono } from "hono";
import { getMultiUserRuntime } from "./index.js";
import { registerMultiUserAdminRoutes } from "./admin-routes.js";

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
    return auth.handler(c.req.raw);
  });

  app.get("/me", async (c) => {
    const { auth, assignments } = getRuntimeOrThrow();
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ user: null, session: null }, 401);
    }

    const userId = String(session.user.id);
    const user = session.user as Record<string, unknown>;
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
