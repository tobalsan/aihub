import {
  CreateScheduleRequestSchema,
  SchedulerExtensionConfigSchema,
  UpdateScheduleRequestSchema,
  type Extension,
  type ExtensionContext,
} from "@aihub/shared";
import type { Hono } from "hono";
import {
  SchedulerService,
  clearSchedulerContext,
  getScheduler,
  setSchedulerContext,
  startScheduler,
  stopScheduler,
} from "./service.js";
import { computeNextRunAtMs } from "./schedule.js";

const schedulerExtension: Extension = {
  id: "scheduler",
  displayName: "Scheduler",
  description: "Cron-like scheduled agent execution",
  dependencies: [],
  configSchema: SchedulerExtensionConfigSchema,
  routePrefixes: ["/api/schedules"],
  validateConfig(raw) {
    const result = SchedulerExtensionConfigSchema.safeParse(raw);
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
  async start(ctx: ExtensionContext) {
    setSchedulerContext(ctx);
    await startScheduler();
  },
  async stop() {
    await stopScheduler();
    clearSchedulerContext();
  },
  capabilities() {
    return ["schedules"];
  },
};

export { schedulerExtension };

export {
  SchedulerService,
  getScheduler,
  startScheduler,
  stopScheduler,
  computeNextRunAtMs,
};
