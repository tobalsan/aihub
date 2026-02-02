import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import * as path from "node:path";
import {
  SendMessageRequestSchema,
  CreateScheduleRequestSchema,
  UpdateScheduleRequestSchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  StartProjectRunRequestSchema,
} from "@aihub/shared";
import type { UpdateProjectRequest } from "@aihub/shared";
import { buildProjectStartPrompt, normalizeProjectStatus } from "@aihub/shared";
import { getActiveAgents, getAgent, isAgentActive, resolveWorkspaceDir, getConfig } from "../config/index.js";
import { runAgent, getAllSessionsForAgent, getAgentStatuses, getSessionHistory, getFullSessionHistory } from "../agents/index.js";
import { runHeartbeat } from "../heartbeat/index.js";
import type { HistoryViewMode } from "@aihub/shared";
import { getScheduler } from "../scheduler/index.js";
import { resolveSessionId, getSessionEntry, isAbortTrigger, getSessionThinkLevel } from "../sessions/index.js";
import { scanTaskboard, getTaskboardItem } from "../taskboard/index.js";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  saveAttachments,
  resolveAttachmentFile,
} from "../projects/index.js";
import { listSubagents, listAllSubagents, getSubagentLogs, listProjectBranches } from "../subagents/index.js";
import { spawnSubagent, interruptSubagent, killSubagent } from "../subagents/runner.js";
import { getRecentActivity } from "../activity/index.js";
import { saveUploadedFile, isAllowedMimeType, getAllowedMimeTypes } from "../media/upload.js";

const api = new Hono();

function normalizeRunAgent(value?: string): { type: "aihub"; id: string } | { type: "cli"; id: string } | null {
  if (!value) return null;
  if (value.startsWith("aihub:")) return { type: "aihub", id: value.slice(6) };
  if (value.startsWith("cli:")) return { type: "cli", id: value.slice(4) };
  return null;
}

function slugifyTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// GET /api/agents - list all agents (respects single-agent mode)
api.get("/agents", (c) => {
  const agents = getActiveAgents();
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
    workspace: agent.workspace ? resolveWorkspaceDir(agent.workspace) : undefined,
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
    // Handle /abort - skip session resolution to avoid creating new session
    if (isAbortTrigger(parsed.data.message)) {
      const result = await runAgent({
        agentId: agent.id,
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
      sessionKey: parsed.data.sessionKey ?? "main",
      thinkLevel: parsed.data.thinkLevel,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/agents/:id/heartbeat - trigger heartbeat for agent
api.post("/agents/:id/heartbeat", async (c) => {
  const agentId = c.req.param("id");
  const agent = getAgent(agentId);
  if (!agent || !isAgentActive(agentId)) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const result = await runHeartbeat(agentId);
  return c.json(result);
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

  // Only include thinkingLevel for OAuth agents
  const thinkingLevel = agent.auth?.mode === "oauth"
    ? getSessionThinkLevel(agentId, sessionKey)
    : undefined;

  return c.json({ messages, sessionId: entry.sessionId, view, thinkingLevel });
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

// POST /api/projects/:id/start - start project run using stored metadata
api.post("/projects/:id/start", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = StartProjectRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const config = getConfig();
  const projectResult = await getProject(config, id);
  if (!projectResult.ok) {
    return c.json({ error: projectResult.error }, 404);
  }
  const project = projectResult.data;
  const frontmatter = project.frontmatter ?? {};

  const status = typeof frontmatter.status === "string" ? frontmatter.status : "";
  const normalizedStatus = normalizeProjectStatus(status);

  const runAgentValue = typeof frontmatter.runAgent === "string" ? frontmatter.runAgent : "";
  const initialRunAgent = normalizeRunAgent(runAgentValue);
  const hasValidRunAgent = Boolean(initialRunAgent);
  let runAgentSelection = initialRunAgent;
  if (!runAgentSelection) {
    const agents = getActiveAgents();
    if (agents.length === 0) {
      return c.json({ error: "No active agents available" }, 400);
    }
    const preferred =
      normalizedStatus === "shaping"
        ? agents.find((agent) => agent.name === "Project Manager")
        : null;
    const selected = preferred ?? agents[0];
    runAgentSelection = { type: "aihub", id: selected.id };
  }

  let nextRunAgentValue = runAgentValue;
  if (!nextRunAgentValue || !hasValidRunAgent) {
    nextRunAgentValue =
      runAgentSelection.type === "aihub" ? `aihub:${runAgentSelection.id}` : `cli:${runAgentSelection.id}`;
  }

  const repo = typeof frontmatter.repo === "string" ? frontmatter.repo : "";
  const basePath = (project.absolutePath || project.path).replace(/\/$/, "");
  const absReadmePath = basePath.endsWith("README.md") ? basePath : `${basePath}/README.md`;
  const relBasePath = project.path.replace(/\/$/, "");
  const relReadmePath = relBasePath.endsWith("README.md") ? relBasePath : `${relBasePath}/README.md`;
  const readmePath = runAgentSelection.type === "aihub" ? absReadmePath : relReadmePath;

  const prompt = buildProjectStartPrompt({
    title: project.title,
    status,
    path: project.path,
    content: project.content,
    readmePath,
    repo,
    customPrompt: parsed.data.customPrompt,
  });

  const updates: Partial<UpdateProjectRequest> = {};

  if (runAgentSelection.type === "aihub") {
    const agent = getAgent(runAgentSelection.id);
    if (!agent || !isAgentActive(runAgentSelection.id)) {
      return c.json({ error: "Agent not found" }, 404);
    }
    const sessionKeys =
      typeof frontmatter.sessionKeys === "object" && frontmatter.sessionKeys !== null
        ? (frontmatter.sessionKeys as Record<string, string>)
        : {};
    const sessionKey = sessionKeys[agent.id] ?? `project:${project.id}:${agent.id}`;
    if (!sessionKeys[agent.id]) {
      updates.sessionKeys = { ...sessionKeys, [agent.id]: sessionKey };
    }
    if (!runAgentValue || !hasValidRunAgent) {
      updates.runAgent = nextRunAgentValue;
    }
    if (normalizedStatus === "todo") {
      updates.status = "in_progress";
    }

    runAgent({
      agentId: agent.id,
      message: prompt,
      sessionKey,
    }).catch((err) => {
      console.error(`[projects:${project.id}] start run failed:`, err);
    });

    if (Object.keys(updates).length > 0) {
      await updateProject(config, project.id, updates);
    }

    return c.json({ ok: true, type: "aihub", sessionKey });
  }

  if (!["claude", "codex", "droid", "gemini"].includes(runAgentSelection.id)) {
    return c.json({ error: `Unsupported CLI: ${runAgentSelection.id}` }, 400);
  }

  const runMode = typeof frontmatter.runMode === "string" ? frontmatter.runMode : "main-run";
  const slug = runMode === "worktree" ? slugifyTitle(project.title) : "main";
  if (!slug) {
    return c.json({ error: "Slug required" }, 400);
  }

  const result = await spawnSubagent(config, {
    projectId: project.id,
    slug,
    cli: runAgentSelection.id as "claude" | "codex" | "droid" | "gemini",
    prompt,
    mode: runMode === "worktree" ? "worktree" : "main-run",
    baseBranch: "main",
  });
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  updates.runAgent = nextRunAgentValue;
  updates.runMode = runMode;
  if (normalizedStatus === "todo") {
    updates.status = "in_progress";
  }
  if (Object.keys(updates).length > 0) {
    await updateProject(config, project.id, updates);
  }

  return c.json({ ok: true, type: "cli", slug, runMode });
});

// GET /api/projects - list projects (frontmatter only)
api.get("/projects", async (c) => {
  const config = getConfig();
  const result = await listProjects(config);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.data);
});

// POST /api/projects - create project
api.post("/projects", async (c) => {
  const body = await c.req.json();
  const parsed = CreateProjectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const config = getConfig();
  const result = await createProject(config, parsed.data);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.data, 201);
});

// GET /api/projects/:id - get project (full README)
api.get("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const result = await getProject(config, id);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json(result.data);
});

// PATCH /api/projects/:id - update project (frontmatter + README)
api.patch("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = UpdateProjectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const config = getConfig();
  const result = await updateProject(config, id, parsed.data);
  if (!result.ok) {
    const status = result.error.startsWith("Project already exists") ? 409 : 404;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data);
});

// POST /api/projects/:id/attachments - upload attachments
api.post("/projects/:id/attachments", async (c) => {
  const id = c.req.param("id");

  const formData = await c.req.formData();
  const files: Array<{ name: string; data: Buffer }> = [];

  for (const [, value] of formData.entries()) {
    if (value instanceof File) {
      const arrayBuffer = await value.arrayBuffer();
      files.push({
        name: value.name,
        data: Buffer.from(arrayBuffer),
      });
    }
  }

  if (files.length === 0) {
    return c.json({ error: "No files provided" }, 400);
  }

  const config = getConfig();
  const result = await saveAttachments(config, id, files);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  return c.json(result.data);
});

function attachmentContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

// GET /api/projects/:id/attachments/:name - fetch attachment
api.get("/projects/:id/attachments/:name", async (c) => {
  const id = c.req.param("id");
  const name = c.req.param("name");

  const config = getConfig();
  const result = await resolveAttachmentFile(config, id, name);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  const type = attachmentContentType(result.data.name);
  c.header("Content-Type", type);
  const nodeStream = createReadStream(result.data.path);
  return c.body(Readable.toWeb(nodeStream) as ReadableStream);
});

// GET /api/projects/:id/subagents - list subagents
api.get("/projects/:id/subagents", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const result = await listSubagents(config, id);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json(result.data);
});

// GET /api/subagents - list all subagents
api.get("/subagents", async (c) => {
  const config = getConfig();
  const items = await listAllSubagents(config);
  return c.json({ items });
});

// GET /api/activity - recent activity feed
api.get("/activity", async (c) => {
  const config = getConfig();
  const offsetParam = c.req.query("offset") ?? "0";
  const limitParam = c.req.query("limit") ?? "20";
  const offset = Number(offsetParam);
  const limit = Number(limitParam);
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(limit) || limit < 1) {
    return c.json({ error: "Invalid pagination params" }, 400);
  }
  const events = await getRecentActivity(config, { offset, limit });
  return c.json({ events });
});

// POST /api/projects/:id/subagents - spawn subagent
api.post("/projects/:id/subagents", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const slug = typeof body.slug === "string" ? body.slug : "";
  const cli = typeof body.cli === "string" ? body.cli : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const mode = typeof body.mode === "string" ? body.mode : undefined;
  const baseBranch = typeof body.baseBranch === "string" ? body.baseBranch : undefined;
  const resume = typeof body.resume === "boolean" ? body.resume : undefined;

  if (!slug || !cli || !prompt) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const config = getConfig();
  const result = await spawnSubagent(config, {
    projectId: id,
    slug,
    cli: cli as "claude" | "codex" | "droid" | "gemini",
    prompt,
    mode: mode as "main-run" | "worktree" | undefined,
    baseBranch,
    resume,
  });
  if (!result.ok) {
    const status = result.error.startsWith("Project not found") ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data, 201);
});

// POST /api/projects/:id/subagents/:slug/interrupt - interrupt subagent
api.post("/projects/:id/subagents/:slug/interrupt", async (c) => {
  const id = c.req.param("id");
  const slug = c.req.param("slug");
  const config = getConfig();
  const result = await interruptSubagent(config, id, slug);
  if (!result.ok) {
    const status = result.error.startsWith("Project not found") ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data);
});

// POST /api/projects/:id/subagents/:slug/kill - kill subagent
api.post("/projects/:id/subagents/:slug/kill", async (c) => {
  const id = c.req.param("id");
  const slug = c.req.param("slug");
  const config = getConfig();
  const result = await killSubagent(config, id, slug);
  if (!result.ok) {
    const status =
      result.error.startsWith("Project not found") || result.error.startsWith("Subagent not found") ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data);
});

// GET /api/projects/:id/subagents/:slug/logs - subagent logs
api.get("/projects/:id/subagents/:slug/logs", async (c) => {
  const id = c.req.param("id");
  const slug = c.req.param("slug");
  const sinceParam = c.req.query("since") ?? "0";
  const since = Number(sinceParam);
  if (!Number.isFinite(since) || since < 0) {
    return c.json({ error: "Invalid since cursor" }, 400);
  }
  const config = getConfig();
  const result = await getSubagentLogs(config, id, slug, since);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json(result.data);
});

// GET /api/projects/:id/branches - list git branches
api.get("/projects/:id/branches", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const result = await listProjectBranches(config, id);
  if (!result.ok) {
    const status = result.error === "Project repo not set" ? 400 : 404;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data);
});

// GET /api/taskboard - list all todos and projects (excluding done)
api.get("/taskboard", async (c) => {
  const config = getConfig();
  const result = await scanTaskboard(config.taskboard);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.data);
});

// GET /api/taskboard/:type/:id - get full content of a specific item
api.get("/taskboard/:type/:id", async (c) => {
  const type = c.req.param("type");
  const id = c.req.param("id");
  const companion = c.req.query("companion");

  if (type !== "todo" && type !== "project") {
    return c.json({ error: "Invalid type. Must be 'todo' or 'project'" }, 400);
  }

  const config = getConfig();
  const result = await getTaskboardItem(config.taskboard, type, id, companion);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json(result.data);
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
        { error: `Unsupported file type: ${mimeType}`, allowedTypes: getAllowedMimeTypes() },
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
