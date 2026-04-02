import {
  CreateScheduleRequestSchema,
  SchedulerComponentConfigSchema,
  UpdateScheduleRequestSchema,
  type Component,
  type ComponentContext,
} from "@aihub/shared";
import type { Hono } from "hono";
import {
  getScheduler,
  startScheduler,
  stopScheduler,
} from "../../scheduler/index.js";

const schedulerComponent: Component = {
  id: "scheduler",
  displayName: "Scheduler",
  dependencies: [],
  requiredSecrets: [],
  validateConfig(raw) {
    const result = SchedulerComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes(app: Hono) {
    app.get("/schedules", async (c) => {
      const scheduler = getScheduler();
      const jobs = await scheduler.list();
      return c.json(jobs);
    });

    app.post("/schedules", async (c) => {
      const body = await c.req.json();
      const parsed = CreateScheduleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }

      const scheduler = getScheduler();
      const job = await scheduler.add(parsed.data);
      return c.json(job, 201);
    });

    app.patch("/schedules/:id", async (c) => {
      const id = c.req.param("id");
      const body = await c.req.json();
      const parsed = UpdateScheduleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }

      const scheduler = getScheduler();
      try {
        const job = await scheduler.update(id, parsed.data);
        return c.json(job);
      } catch {
        return c.json({ error: "Schedule not found" }, 404);
      }
    });

    app.delete("/schedules/:id", async (c) => {
      const id = c.req.param("id");
      const scheduler = getScheduler();
      const result = await scheduler.remove(id);
      if (!result.removed) {
        return c.json({ error: "Schedule not found" }, 404);
      }
      return c.json({ ok: true });
    });
  },
  async start(_ctx: ComponentContext) {
    await startScheduler();
  },
  async stop() {
    await stopScheduler();
  },
  capabilities() {
    return ["schedules"];
  },
};

export { schedulerComponent };
