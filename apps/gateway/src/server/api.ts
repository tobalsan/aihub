import { Hono } from "hono";
import {
  SendMessageRequestSchema,
  CreateScheduleRequestSchema,
  UpdateScheduleRequestSchema,
} from "@aihub/shared";
import { getActiveAgents, getAgent, isAgentActive } from "../config/index.js";
import { runAgent, getAllSessionsForAgent, getSessionHistory, getFullSessionHistory } from "../agents/index.js";
import type { HistoryViewMode } from "@aihub/shared";
import { getScheduler } from "../scheduler/index.js";
import { resolveSessionId, getSessionEntry } from "../sessions/index.js";

const api = new Hono();

// GET /api/agents - list all agents (respects single-agent mode)
api.get("/agents", (c) => {
  const agents = getActiveAgents();
  return c.json(
    agents.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
    }))
  );
});

// GET /api/agents/:id - get single agent
api.get("/agents/:id", (c) => {
  const agentId = c.req.param("id");
  const agent = getAgent(agentId);
  if (!agent || !isAgentActive(agentId)) {
    return c.json({ error: "Agent not found" }, 404);
  }
  return c.json({
    id: agent.id,
    name: agent.name,
    model: agent.model,
  });
});

// GET /api/agents/:id/status - get agent status
api.get("/agents/:id/status", (c) => {
  const agentId = c.req.param("id");
  const agent = getAgent(agentId);
  if (!agent || !isAgentActive(agentId)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const sessions = getAllSessionsForAgent(agent.id);
  const streaming = sessions.some((s) => s.isStreaming);
  const lastActivity = Math.max(0, ...sessions.map((s) => s.lastActivity));

  return c.json({
    id: agent.id,
    name: agent.name,
    isStreaming: streaming,
    lastActivity: lastActivity || undefined,
  });
});

// POST /api/agents/:id/messages - send message to agent
api.post("/agents/:id/messages", async (c) => {
  const agentId = c.req.param("id");
  const agent = getAgent(agentId);
  if (!agent || !isAgentActive(agentId)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const body = await c.req.json();
  const parsed = SendMessageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  try {
    // Resolve sessionId from sessionKey if not explicitly provided
    let sessionId = parsed.data.sessionId;
    let message = parsed.data.message;
    if (!sessionId && parsed.data.sessionKey) {
      const resolved = await resolveSessionId({
        agentId: agent.id,
        sessionKey: parsed.data.sessionKey,
        message: parsed.data.message,
      });
      sessionId = resolved.sessionId;
      message = resolved.message;
    }

    const result = await runAgent({
      agentId: agent.id,
      message,
      sessionId,
      thinkLevel: parsed.data.thinkLevel,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/agents/:id/history - get session history
// Query params: sessionKey (default "main"), view ("simple" | "full", default "simple")
api.get("/agents/:id/history", async (c) => {
  const agentId = c.req.param("id");
  const agent = getAgent(agentId);
  if (!agent || !isAgentActive(agentId)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const sessionKey = c.req.query("sessionKey") ?? "main";
  const view = (c.req.query("view") ?? "simple") as HistoryViewMode;
  const entry = getSessionEntry(agentId, sessionKey);

  if (!entry) {
    return c.json({ messages: [], view });
  }

  const messages =
    view === "full"
      ? await getFullSessionHistory(agentId, entry.sessionId)
      : await getSessionHistory(agentId, entry.sessionId);

  return c.json({ messages, sessionId: entry.sessionId, view });
});

// GET /api/schedules - list schedules
api.get("/schedules", async (c) => {
  const scheduler = getScheduler();
  const jobs = await scheduler.list();
  return c.json(jobs);
});

// POST /api/schedules - create schedule
api.post("/schedules", async (c) => {
  const body = await c.req.json();
  const parsed = CreateScheduleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const scheduler = getScheduler();
  const job = await scheduler.add(parsed.data);
  return c.json(job, 201);
});

// PATCH /api/schedules/:id - update schedule
api.patch("/schedules/:id", async (c) => {
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

// DELETE /api/schedules/:id - delete schedule
api.delete("/schedules/:id", async (c) => {
  const id = c.req.param("id");
  const scheduler = getScheduler();
  const result = await scheduler.remove(id);
  if (!result.removed) {
    return c.json({ error: "Schedule not found" }, 404);
  }
  return c.json({ ok: true });
});

export { api };
