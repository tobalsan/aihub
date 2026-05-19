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
  getSchedulerContext,
  setSchedulerContext,
  startScheduler,
  stopScheduler,
} from "./service.js";
import { computeNextRunAtMs } from "./schedule.js";
import { readLatestOutputFile } from "./store.js";

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
      const agentId = c.req.query("agent") ?? undefined;
      const jobs = await scheduler.list(agentId);
      return c.json(jobs);
    });

    app.post("/schedules", async (c) => {
      const body = await c.req.json();
      const parsed = CreateScheduleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }

      if (!parsed.data.agentId) {
        return c.json({ error: "agentId is required" }, 400);
      }
      const scheduler = getScheduler();
      const { agentId, ...input } = parsed.data;
      try {
        const job = await scheduler.add(agentId, input);
        return c.json(job, 201);
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : "Schedule create failed" },
          404
        );
      }
    });

    app.get("/schedules/:agentId/:id/tail", async (c) => {
      const agentId = c.req.param("agentId");
      const id = c.req.param("id");
      const ctx = getSchedulerContext();
      const agent = ctx.getAgent(agentId);
      if (!agent) return c.json({ error: "Agent not found" }, 404);
      const latest = await readLatestOutputFile(ctx.resolveWorkspaceDir(agent), id);
      if (!latest) return c.json({ error: "Output not found" }, 404);
      return c.json(latest);
    });

    app.patch("/schedules/:agentId/:id", async (c) => {
      const agentId = c.req.param("agentId");
      const id = c.req.param("id");
      const body = await c.req.json();
      const parsed = UpdateScheduleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }

      const scheduler = getScheduler();
      try {
        const job = await scheduler.update(agentId, id, parsed.data);
        return c.json(job);
      } catch {
        return c.json({ error: "Schedule not found" }, 404);
      }
    });

    app.delete("/schedules/:agentId/:id", async (c) => {
      const agentId = c.req.param("agentId");
      const id = c.req.param("id");
      const scheduler = getScheduler();
      const result = await scheduler.remove(agentId, id);
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
export { latestAssistantText, writeCronRunOutput } from "./output.js";

export { registerSchedulerCommands } from "./cli/index.js";
