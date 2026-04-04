import { Hono, type Context } from "hono";
import { SendMessageRequestSchema } from "@aihub/shared";
import {
  getActiveAgents,
  getAgent,
  isAgentActive,
  resolveWorkspaceDir,
} from "../config/index.js";
import { getLoadedComponents } from "../components/registry.js";
import {
  runAgent,
  getAllSessionsForAgent,
  getAgentStatuses,
  getSessionHistory,
  getFullSessionHistory,
} from "../agents/index.js";
import type { HistoryViewMode } from "@aihub/shared";
import {
  resolveSessionId,
  getSessionEntry,
  isAbortTrigger,
  getSessionThinkLevel,
} from "../sessions/index.js";
import {
  saveUploadedFile,
  isAllowedMimeType,
  getAllowedMimeTypes,
} from "../media/upload.js";
import {
  getForwardedAuthContext,
} from "../components/multi-user/middleware.js";
import {
  getAgentFilter,
  getMultiUserRuntime,
} from "../components/multi-user/index.js";

const api = new Hono();

function getRequestUserId(c: Context): string | undefined {
  return getForwardedAuthContext(c.req.raw.headers)?.session.userId;
}

function getVisibleAgents(c: Context) {
  const agents = getActiveAgents();
  const authContext = getForwardedAuthContext(c.req.raw.headers);
  if (!getMultiUserRuntime() || !authContext) {
    return agents;
  }
  return getAgentFilter(authContext.user.id, authContext.user.role)(agents);
}

api.get("/capabilities", (c) => {
  const components = Object.fromEntries(
    getLoadedComponents().map((component) => [component.id, true])
  );
  const authContext = getForwardedAuthContext(c.req.raw.headers);
  const multiUserEnabled = !!getMultiUserRuntime();
  const agents = getVisibleAgents(c);

  return c.json({
    version: 2,
    components,
    agents: agents.map((agent) => agent.id),
    multiUser: multiUserEnabled,
    ...(multiUserEnabled && authContext
      ? {
          user: {
            id: authContext.user.id,
            name: authContext.user.name ?? null,
            email: authContext.user.email ?? null,
            role: authContext.user.role ?? null,
          },
        }
      : {}),
  });
});

// GET /api/agents - list all agents (respects single-agent mode)
api.get("/agents", (c) => {
  const agents = getVisibleAgents(c);
  return c.json(
    agents.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      sdk: a.sdk ?? "pi",
      workspace: a.workspace ? resolveWorkspaceDir(a.workspace) : undefined,
      authMode: a.auth?.mode,
      queueMode: a.queueMode ?? "queue",
    }))
  );
});

// GET /api/agents/status - get all agent streaming statuses
api.get("/agents/status", (c) => {
  const agents = getActiveAgents();
  const statuses = getAgentStatuses(agents.map((agent) => agent.id));
  return c.json({ statuses });
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
    sdk: agent.sdk ?? "pi",
    workspace: agent.workspace
      ? resolveWorkspaceDir(agent.workspace)
      : undefined,
    authMode: agent.auth?.mode,
    queueMode: agent.queueMode ?? "queue",
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
    const userId = getRequestUserId(c);
    // Handle /abort - skip session resolution to avoid creating new session
    if (isAbortTrigger(parsed.data.message)) {
      const result = await runAgent({
        agentId: agent.id,
        userId,
        message: parsed.data.message,
        sessionId: parsed.data.sessionId,
        sessionKey: parsed.data.sessionKey,
      });
      return c.json(result);
    }

    // Resolve sessionId from sessionKey if not explicitly provided
    let sessionId = parsed.data.sessionId;
    let message = parsed.data.message;
    if (!sessionId && parsed.data.sessionKey) {
      const resolved = await resolveSessionId({
        agentId: agent.id,
        userId,
        sessionKey: parsed.data.sessionKey,
        message: parsed.data.message,
      });
      sessionId = resolved.sessionId;
      message = resolved.message;
    }

    const result = await runAgent({
      agentId: agent.id,
      userId,
      message,
      sessionId,
      sessionKey: parsed.data.sessionKey ?? "main",
      thinkLevel: parsed.data.thinkLevel,
    });
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
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
  const userId = getRequestUserId(c);
  const entry = getSessionEntry(agentId, sessionKey, userId);

  if (!entry) {
    return c.json({ messages: [], view });
  }

  const messages =
    view === "full"
      ? await getFullSessionHistory(agentId, entry.sessionId, userId)
      : await getSessionHistory(agentId, entry.sessionId, userId);

  // Only include thinkingLevel for OAuth agents
  const thinkingLevel =
    agent.auth?.mode === "oauth"
      ? getSessionThinkLevel(agentId, sessionKey, userId)
      : undefined;

  return c.json({ messages, sessionId: entry.sessionId, view, thinkingLevel });
});

// POST /api/media/upload - upload a file (multipart/form-data)
api.post("/media/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    const mimeType = file.type || "application/octet-stream";
    if (!isAllowedMimeType(mimeType)) {
      return c.json(
        {
          error: `Unsupported file type: ${mimeType}`,
          allowedTypes: getAllowedMimeTypes(),
        },
        400
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await saveUploadedFile(arrayBuffer, mimeType, file.name);

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return c.json({ error: message }, 500);
  }
});

// GET /api/media/allowed-types - list allowed file types
api.get("/media/allowed-types", (c) => {
  return c.json({ types: getAllowedMimeTypes() });
});

export { api };
