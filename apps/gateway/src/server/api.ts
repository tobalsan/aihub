import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import * as path from "node:path";
import os from "node:os";
import {
  SendMessageRequestSchema,
  CreateScheduleRequestSchema,
  UpdateScheduleRequestSchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  ProjectCommentRequestSchema,
  UpdateProjectCommentRequestSchema,
  StartProjectRunRequestSchema,
} from "@aihub/shared";
import type { UpdateProjectRequest } from "@aihub/shared";
import { buildProjectStartPrompt, normalizeProjectStatus } from "@aihub/shared";
import {
  getActiveAgents,
  getAgent,
  isAgentActive,
  resolveWorkspaceDir,
  getConfig,
} from "../config/index.js";
import {
  runAgent,
  getAllSessionsForAgent,
  getAgentStatuses,
  getSessionHistory,
  getFullSessionHistory,
} from "../agents/index.js";
import { runHeartbeat } from "../heartbeat/index.js";
import type { HistoryViewMode } from "@aihub/shared";
import { getScheduler } from "../scheduler/index.js";
import {
  resolveSessionId,
  getSessionEntry,
  isAbortTrigger,
  getSessionThinkLevel,
} from "../sessions/index.js";
import { scanTaskboard, getTaskboardItem } from "../taskboard/index.js";
import {
  listProjects,
  listArchivedProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  appendProjectComment,
  updateProjectComment,
  deleteProjectComment,
  saveAttachments,
  resolveAttachmentFile,
} from "../projects/index.js";
import {
  listSubagents,
  listAllSubagents,
  getSubagentLogs,
  listProjectBranches,
  archiveSubagent,
  unarchiveSubagent,
} from "../subagents/index.js";
import {
  spawnSubagent,
  spawnRalphLoop,
  interruptSubagent,
  killSubagent,
} from "../subagents/runner.js";
import {
  getRecentActivity,
  recordProjectStatusActivity,
  recordCommentActivity,
} from "../activity/index.js";
import {
  saveUploadedFile,
  isAllowedMimeType,
  getAllowedMimeTypes,
} from "../media/upload.js";
import { parseMarkdownFile } from "../taskboard/parser.js";

const api = new Hono();

function normalizeRunAgent(
  value?: string
): { type: "aihub"; id: string } | { type: "cli"; id: string } | null {
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

function formatThreadDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function generateRalphLoopSlug(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `ralph-${now}-${rand}`;
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
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
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
  const thinkingLevel =
    agent.auth?.mode === "oauth"
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

  const status =
    typeof frontmatter.status === "string" ? frontmatter.status : "";
  const normalizedStatus = normalizeProjectStatus(status);

  const requestedRunAgentValue =
    typeof parsed.data.runAgent === "string" ? parsed.data.runAgent.trim() : "";
  let runAgentSelection = normalizeRunAgent(requestedRunAgentValue);
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

  let runMode: "main-run" | "worktree" | undefined;
  let slug: string | undefined;
  let baseBranch: string | undefined;
  if (runAgentSelection.type === "cli") {
    const requestedRunModeValue =
      typeof parsed.data.runMode === "string" ? parsed.data.runMode : "";
    runMode = requestedRunModeValue === "worktree" ? "worktree" : "main-run";
    const requestedSlugValue =
      typeof parsed.data.slug === "string" ? parsed.data.slug.trim() : "";
    slug =
      runMode === "worktree"
        ? requestedSlugValue || slugifyTitle(project.title)
        : "main";
    baseBranch =
      typeof parsed.data.baseBranch === "string" &&
      parsed.data.baseBranch.trim()
        ? parsed.data.baseBranch.trim()
        : "main";
  }

  let runAgentLabel: string | undefined;
  if (runAgentSelection.type === "cli") {
    const id = runAgentSelection.id;
    runAgentLabel =
      id === "codex"
        ? "Codex"
        : id === "claude"
          ? "Claude"
          : id === "droid"
            ? "Droid"
            : id === "gemini"
              ? "Gemini"
              : undefined;
  } else {
    runAgentLabel = getAgent(runAgentSelection.id)?.name;
  }

  const repo = typeof frontmatter.repo === "string" ? frontmatter.repo : "";
  let implementationRepo = repo;
  if (runMode === "worktree" && slug) {
    const root = config.projects?.root ?? "~/projects";
    const resolvedRoot = root.startsWith("~/")
      ? path.join(os.homedir(), root.slice(2))
      : root;
    implementationRepo = path.join(
      resolvedRoot,
      ".workspaces",
      project.id,
      slug
    );
  }
  const basePath = (project.absolutePath || project.path).replace(/\/$/, "");
  const absReadmePath = basePath.endsWith("README.md")
    ? basePath
    : `${basePath}/README.md`;
  const relBasePath = project.path.replace(/\/$/, "");
  const relReadmePath = relBasePath.endsWith("README.md")
    ? relBasePath
    : `${relBasePath}/README.md`;
  const readmePath =
    runAgentSelection.type === "aihub" ? absReadmePath : relReadmePath;
  const threadPath = path.join(basePath, "THREAD.md");
  let threadContent = "";
  try {
    const parsedThread = await parseMarkdownFile(threadPath);
    threadContent = parsedThread.content.trim();
  } catch {
    // ignore missing thread
  }

  // Combine all docs content (README first, then others)
  const docKeys = Object.keys(project.docs ?? {}).sort((a, b) => {
    if (a === "README") return -1;
    if (b === "README") return 1;
    return a.localeCompare(b);
  });
  let fullContent = project.docs?.README ?? "";
  if (threadContent) {
    fullContent += `\n\n## THREAD\n\n${threadContent}`;
  }
  for (const key of docKeys) {
    if (key === "README") continue;
    const docContent = project.docs?.[key];
    if (docContent) {
      fullContent += `\n\n## ${key}\n\n${docContent}`;
    }
  }

  const prompt = buildProjectStartPrompt({
    title: project.title,
    status,
    path: basePath,
    content: fullContent,
    specsPath: readmePath,
    repo: implementationRepo,
    customPrompt: parsed.data.customPrompt,
    runAgentLabel,
  });

  const updates: Partial<UpdateProjectRequest> = {};
  const hasLegacyRunConfig =
    typeof frontmatter.runAgent === "string" ||
    typeof frontmatter.runMode === "string" ||
    typeof frontmatter.baseBranch === "string";

  if (runAgentSelection.type === "aihub") {
    const agent = getAgent(runAgentSelection.id);
    if (!agent || !isAgentActive(runAgentSelection.id)) {
      return c.json({ error: "Agent not found" }, 404);
    }
    const sessionKeys =
      typeof frontmatter.sessionKeys === "object" &&
      frontmatter.sessionKeys !== null
        ? (frontmatter.sessionKeys as Record<string, string>)
        : {};
    const sessionKey =
      sessionKeys[agent.id] ?? `project:${project.id}:${agent.id}`;
    if (!sessionKeys[agent.id]) {
      updates.sessionKeys = { ...sessionKeys, [agent.id]: sessionKey };
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

    if (Object.keys(updates).length > 0 || hasLegacyRunConfig) {
      await updateProject(config, project.id, updates);
    }

    return c.json({ ok: true, type: "aihub", sessionKey });
  }

  if (!["claude", "codex", "droid", "gemini"].includes(runAgentSelection.id)) {
    return c.json({ error: `Unsupported CLI: ${runAgentSelection.id}` }, 400);
  }

  const runModeValue = runMode ?? "main-run";
  const slugValue = slug ?? "main";
  if (!slug) {
    return c.json({ error: "Slug required" }, 400);
  }
  const baseBranchValue = baseBranch ?? "main";

  const result = await spawnSubagent(config, {
    projectId: project.id,
    slug: slugValue,
    cli: runAgentSelection.id as "claude" | "codex" | "droid" | "gemini",
    prompt,
    mode: runModeValue === "worktree" ? "worktree" : "main-run",
    baseBranch: baseBranchValue,
  });
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  if (normalizedStatus === "todo") {
    updates.status = "in_progress";
  }
  if (Object.keys(updates).length > 0 || hasLegacyRunConfig) {
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

// GET /api/projects/archived - list archived projects
api.get("/projects/archived", async (c) => {
  const config = getConfig();
  const result = await listArchivedProjects(config);
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

// GET /api/projects/:id - get project (README + SPECS + thread)
api.get("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const result = await getProject(config, id);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json(result.data);
});

// PATCH /api/projects/:id - update project (frontmatter + docs)
api.patch("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  if ("runAgent" in body || "runMode" in body || "baseBranch" in body) {
    return c.json(
      { error: "runAgent/runMode/baseBranch not supported on projects" },
      400
    );
  }
  const parsed = UpdateProjectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const config = getConfig();
  let prevStatus: string | null = null;
  if (parsed.data.status) {
    const prev = await getProject(config, id);
    if (prev.ok) {
      prevStatus = normalizeProjectStatus(
        String(prev.data.frontmatter?.status ?? "")
      );
    }
  }
  if (parsed.data.status === "archived") {
    const rest = { ...parsed.data };
    delete rest.status;
    if (Object.keys(rest).length > 0) {
      const updated = await updateProject(config, id, rest);
      if (!updated.ok) {
        const status = updated.error.startsWith("Project already exists")
          ? 409
          : 404;
        return c.json({ error: updated.error }, status);
      }
    }
    const archived = await archiveProject(config, id);
    if (!archived.ok) {
      const status = archived.error.startsWith("Archive already contains")
        ? 409
        : 404;
      return c.json({ error: archived.error }, status);
    }
    const detail = await getProject(config, id);
    if (!detail.ok) {
      return c.json({ error: detail.error }, 404);
    }
    if (prevStatus === null || prevStatus !== "archived") {
      await recordProjectStatusActivity({
        actor: parsed.data.agent,
        projectId: detail.data.id ?? id,
        status: "archived",
      });
    }
    return c.json(detail.data);
  }
  const result = await updateProject(config, id, parsed.data);
  if (!result.ok) {
    const status = result.error.startsWith("Project already exists")
      ? 409
      : 404;
    return c.json({ error: result.error }, status);
  }
  if (parsed.data.status) {
    const nextStatus = normalizeProjectStatus(
      String(result.data.frontmatter?.status ?? "")
    );
    if (prevStatus === null || prevStatus !== nextStatus) {
      await recordProjectStatusActivity({
        actor: parsed.data.agent,
        projectId: result.data.id ?? id,
        status: nextStatus,
      });
    }
  }
  return c.json(result.data);
});

// DELETE /api/projects/:id - delete project (move to trash)
api.delete("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const result = await deleteProject(config, id);
  if (!result.ok) {
    const status = result.error.startsWith("Trash already contains")
      ? 409
      : 404;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data);
});

// POST /api/projects/:id/archive - archive project (move to .archive)
api.post("/projects/:id/archive", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const result = await archiveProject(config, id);
  if (!result.ok) {
    const status = result.error.startsWith("Archive already contains")
      ? 409
      : 404;
    return c.json({ error: result.error }, status);
  }
  await recordProjectStatusActivity({ projectId: id, status: "archived" });
  return c.json(result.data);
});

// POST /api/projects/:id/unarchive - unarchive project (move out of .archive)
api.post("/projects/:id/unarchive", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const result = await unarchiveProject(config, id, "maybe");
  if (!result.ok) {
    const status = result.error.startsWith("Project already exists")
      ? 409
      : 404;
    return c.json({ error: result.error }, status);
  }
  await recordProjectStatusActivity({ projectId: id, status: "maybe" });
  return c.json(result.data);
});

// POST /api/projects/:id/comments - append thread comment
api.post("/projects/:id/comments", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = ProjectCommentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const entry = {
    author: parsed.data.author,
    date: formatThreadDate(new Date()),
    body: parsed.data.message,
  };

  const config = getConfig();
  const result = await appendProjectComment(config, id, entry);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  await recordCommentActivity({
    actor: parsed.data.author,
    projectId: id,
    commentExcerpt: parsed.data.message,
  });
  return c.json(result.data, 201);
});

// PATCH /api/projects/:id/comments/:index - update thread comment
api.patch("/projects/:id/comments/:index", async (c) => {
  const id = c.req.param("id");
  const index = parseInt(c.req.param("index"), 10);
  if (Number.isNaN(index) || index < 0) {
    return c.json({ error: "Invalid comment index" }, 400);
  }

  const body = await c.req.json();
  const parsed = UpdateProjectCommentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const config = getConfig();
  const result = await updateProjectComment(
    config,
    id,
    index,
    parsed.data.body
  );
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json(result.data);
});

// DELETE /api/projects/:id/comments/:index - delete thread comment
api.delete("/projects/:id/comments/:index", async (c) => {
  const id = c.req.param("id");
  const index = parseInt(c.req.param("index"), 10);
  if (Number.isNaN(index) || index < 0) {
    return c.json({ error: "Invalid comment index" }, 400);
  }

  const config = getConfig();
  const result = await deleteProjectComment(config, id, index);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
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
  return c.body(
    Readable.toWeb(createReadStream(result.data.path)) as ReadableStream
  );
});

// GET /api/projects/:id/subagents - list subagents
api.get("/projects/:id/subagents", async (c) => {
  const id = c.req.param("id");
  const includeArchived = c.req.query("includeArchived") === "true";
  const config = getConfig();
  const result = await listSubagents(config, id, includeArchived);
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
  if (
    !Number.isFinite(offset) ||
    offset < 0 ||
    !Number.isFinite(limit) ||
    limit < 1
  ) {
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
  const baseBranch =
    typeof body.baseBranch === "string" ? body.baseBranch : undefined;
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

// POST /api/projects/:id/ralph-loop - spawn ralph loop run
api.post("/projects/:id/ralph-loop", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const cli = typeof body.cli === "string" ? body.cli : "";
  const iterations =
    typeof body.iterations === "number"
      ? body.iterations
      : Number(body.iterations);
  const promptFile =
    typeof body.promptFile === "string" ? body.promptFile : undefined;
  const mode = typeof body.mode === "string" ? body.mode : undefined;
  const baseBranch =
    typeof body.baseBranch === "string" ? body.baseBranch : undefined;

  if (!["codex", "claude"].includes(cli)) {
    return c.json({ error: "cli must be codex or claude" }, 400);
  }
  if (!Number.isFinite(iterations) || iterations < 1) {
    return c.json({ error: "iterations must be >= 1" }, 400);
  }

  const config = getConfig();
  const result = await spawnRalphLoop(config, {
    projectId: id,
    slug: generateRalphLoopSlug(),
    cli: cli as "codex" | "claude",
    iterations,
    promptFile,
    mode: mode as "main-run" | "worktree" | undefined,
    baseBranch,
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
      result.error.startsWith("Project not found") ||
      result.error.startsWith("Subagent not found")
        ? 404
        : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data);
});

// POST /api/projects/:id/subagents/:slug/archive - archive subagent run
api.post("/projects/:id/subagents/:slug/archive", async (c) => {
  const id = c.req.param("id");
  const slug = c.req.param("slug");
  const config = getConfig();
  const result = await archiveSubagent(config, id, slug);
  if (!result.ok) {
    const status =
      result.error.startsWith("Project not found") ||
      result.error.startsWith("Subagent not found")
        ? 404
        : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json(result.data);
});

// POST /api/projects/:id/subagents/:slug/unarchive - unarchive subagent run
api.post("/projects/:id/subagents/:slug/unarchive", async (c) => {
  const id = c.req.param("id");
  const slug = c.req.param("slug");
  const config = getConfig();
  const result = await unarchiveSubagent(config, id, slug);
  if (!result.ok) {
    const status =
      result.error.startsWith("Project not found") ||
      result.error.startsWith("Subagent not found")
        ? 404
        : 400;
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
