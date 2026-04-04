import type { Hono } from "hono";
import { z } from "zod";
import { getAgent } from "../../config/index.js";
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
    if (!getAgent(agentId)) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const { assignments } = getRuntimeOrThrow();
    const authContext = getRequestAuthContext(c);
    if (!authContext) {
      return c.json({ error: "unauthorized" }, 401);
    }
    assignments.setAssignmentsForAgent(
      agentId,
      parsed.data.userIds,
      authContext.user.id
    );

    return c.json({
      agentId,
      userIds: assignments.getAssignmentsForAgent(agentId),
    });
  });
}
