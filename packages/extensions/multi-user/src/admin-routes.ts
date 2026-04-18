import type { Hono } from "hono";
import { z } from "zod";
import { getRequestAuthContext, requireAdmin } from "./middleware.js";
import { getMultiUserRuntime } from "./index.js";

const UpdateAdminUserBodySchema = z
  .object({
    approved: z.boolean().optional(),
    role: z.enum(["admin", "user"]).optional(),
  })
  .refine((data) => data.approved !== undefined || data.role !== undefined, {
    message: "approved or role is required",
  });

const SetAgentAssignmentsBodySchema = z.object({
  userIds: z.array(z.string()),
});

function getRuntimeOrThrow() {
  const runtime = getMultiUserRuntime();
  if (!runtime) {
    throw new Error("multi-user runtime not initialized");
  }
  return runtime;
}

export function registerMultiUserAdminRoutes(app: Hono): void {
  app.get("/admin/users", requireAdmin(), async (c) => {
    const { auth } = getRuntimeOrThrow();
    const result = await auth.api.listUsers({
      headers: c.req.raw.headers,
      query: {},
    });
    return c.json(result);
  });

  app.patch("/admin/users/:id", requireAdmin(), async (c) => {
    const parsed = UpdateAdminUserBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const userId = c.req.param("id");
    const { auth, db } = getRuntimeOrThrow();
    const existing = await auth.api.getUser({
      headers: c.req.raw.headers,
      query: { id: userId },
    });

    if (!existing) {
      return c.json({ error: "User not found" }, 404);
    }

    if (parsed.data.role !== undefined) {
      await auth.api.setRole({
        headers: c.req.raw.headers,
        body: {
          userId,
          role: parsed.data.role,
        },
      });
    }

    if (parsed.data.approved !== undefined) {
      db.prepare("UPDATE user SET approved = ? WHERE id = ?").run(
        parsed.data.approved ? 1 : 0,
        userId
      );
    }

    const updated = await auth.api.getUser({
      headers: c.req.raw.headers,
      query: { id: userId },
    });
    return c.json({ user: updated });
  });

  app.get("/admin/agents/assignments", requireAdmin(), (c) => {
    const { assignments } = getRuntimeOrThrow();
    return c.json({ assignments: assignments.getAllAssignments() });
  });

  app.put("/admin/agents/:agentId/assignments", requireAdmin(), async (c) => {
    const parsed = SetAgentAssignmentsBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const agentId = c.req.param("agentId");
    const { assignments, db, getAgent } = getRuntimeOrThrow();
    if (!getAgent(agentId)) {
      return c.json({ error: "Agent not found" }, 404);
    }
    const authContext = getRequestAuthContext(c);
    if (!authContext) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const userIds = [...new Set(parsed.data.userIds)];
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(", ");
      const existingUserIds = new Set(
        (
          db.prepare(`SELECT id FROM user WHERE id IN (${placeholders})`).all(
            ...userIds
          ) as Array<{ id: string }>
        ).map((row) => row.id)
      );
      const invalidUserIds = userIds.filter((userId) => !existingUserIds.has(userId));

      if (invalidUserIds.length > 0) {
        return c.json(
          {
            error: "Unknown user ids",
            userIds: invalidUserIds,
          },
          400
        );
      }
    }

    try {
      assignments.setAssignmentsForAgent(agentId, userIds, authContext.user.id);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("FOREIGN KEY constraint failed")
      ) {
        return c.json({ error: "Invalid assignment user ids" }, 400);
      }
      throw error;
    }

    return c.json({
      agentId,
      userIds: assignments.getAssignmentsForAgent(agentId),
    });
  });
}
