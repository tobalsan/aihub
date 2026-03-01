import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import * as path from "node:path";
import os from "node:os";
import {
  SendMessageRequestSchema,
  CreateScheduleRequestSchema,
  UpdateScheduleRequestSchema,
  AreaSchema,
  CreateProjectRequestSchema,
  CreateConversationProjectRequestSchema,
  PostConversationMessageRequestSchema,
  UpdateProjectRequestSchema,
  ProjectCommentRequestSchema,
  UpdateProjectCommentRequestSchema,
  StartProjectRunRequestSchema,
} from "@aihub/shared";
import type { UpdateProjectRequest } from "@aihub/shared";
import { buildProjectStartPrompt, normalizeProjectStatus } from "@aihub/shared";
import { z } from "zod";
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
  getProjectChanges,
  commitProjectChanges,
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
  parseTasks,
  serializeTasks,
  readSpec,
  writeSpec,
} from "../projects/index.js";
import {
  listAreas,
  createArea,
  updateArea,
  deleteArea,
  migrateAreas,
} from "../areas/index.js";
import {
  listConversations,
  getConversation,
  resolveConversationAttachment,
  appendConversationMessage,
} from "../conversations/index.js";
import type { ConversationDetail } from "../conversations/index.js";
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
  isSupportedSubagentCli,
  getUnsupportedSubagentCliError,
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

type CliRunMode = "main-run" | "worktree" | "clone";
type CliHarness = "codex" | "claude" | "pi";

const CODEX_MODELS = ["gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"];
const CLAUDE_MODELS = ["opus", "sonnet", "haiku"];
const PI_MODELS = [
  "qwen3.5-plus",
  "qwen3-max-2026-01-23",
  "MiniMax-M2.5",
  "glm-5",
  "kimi-k2.5",
];
const CODEX_REASONING = ["xhigh", "high", "medium", "low"];
const CLAUDE_EFFORT = ["high", "medium", "low"];
const PI_THINKING = ["off", "low", "medium", "high", "xhigh"];

function normalizeRunAgent(
  value?: string
): { type: "aihub"; id: string } | { type: "cli"; id: string } | null {
  if (!value) return null;
  if (value.startsWith("aihub:")) return { type: "aihub", id: value.slice(6) };
  if (value.startsWith("cli:")) return { type: "cli", id: value.slice(4) };
  return null;
}

function normalizeCliRunMode(value: string): CliRunMode {
  if (value === "main-run") return "main-run";
  if (value === "worktree") return "worktree";
  if (value === "clone") return "clone";
  return "clone";
}

function resolveCliSpawnOptions(
  cli: CliHarness,
  model?: string,
  reasoningEffort?: string,
  thinking?: string
):
  | {
      ok: true;
      data: {
        model: string;
        reasoningEffort?: string;
        thinking?: string;
      };
    }
  | { ok: false; error: string } {
  if (cli === "codex") {
    const resolvedModel = model || "gpt-5.3-codex";
    if (!CODEX_MODELS.includes(resolvedModel)) {
      return {
        ok: false,
        error: `Invalid codex model: ${resolvedModel}. Allowed: ${CODEX_MODELS.join(", ")}`,
      };
    }
    const resolvedEffort = reasoningEffort || "high";
    if (!CODEX_REASONING.includes(resolvedEffort)) {
      return {
        ok: false,
        error: `Invalid codex reasoning effort: ${resolvedEffort}. Allowed: ${CODEX_REASONING.join(", ")}`,
      };
    }
    if (thinking) {
      return {
        ok: false,
        error: "thinking is only valid for pi CLI",
      };
    }
    return {
      ok: true,
      data: { model: resolvedModel, reasoningEffort: resolvedEffort },
    };
  }

  if (cli === "claude") {
    const resolvedModel = model || "sonnet";
    if (!CLAUDE_MODELS.includes(resolvedModel)) {
      return {
        ok: false,
        error: `Invalid claude model: ${resolvedModel}. Allowed: ${CLAUDE_MODELS.join(", ")}`,
      };
    }
    const resolvedEffort = reasoningEffort || "high";
    if (!CLAUDE_EFFORT.includes(resolvedEffort)) {
      return {
        ok: false,
        error: `Invalid claude effort: ${resolvedEffort}. Allowed: ${CLAUDE_EFFORT.join(", ")}`,
      };
    }
    if (thinking) {
      return {
        ok: false,
        error: "thinking is only valid for pi CLI",
      };
    }
    return {
      ok: true,
      data: { model: resolvedModel, reasoningEffort: resolvedEffort },
    };
  }

  const resolvedModel = model || "qwen3.5-plus";
  if (!PI_MODELS.includes(resolvedModel)) {
    return {
      ok: false,
      error: `Invalid pi model: ${resolvedModel}. Allowed: ${PI_MODELS.join(", ")}`,
    };
  }
  const resolvedThinking = thinking || "medium";
  if (!PI_THINKING.includes(resolvedThinking)) {
    return {
      ok: false,
      error: `Invalid pi thinking: ${resolvedThinking}. Allowed: ${PI_THINKING.join(", ")}`,
    };
  }
  if (reasoningEffort) {
    return {
      ok: false,
      error: "reasoningEffort is only valid for codex and claude CLIs",
    };
  }
  return {
    ok: true,
    data: { model: resolvedModel, thinking: resolvedThinking },
  };
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

function formatClockTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type MentionTarget = "cloud" | "codex" | "claude" | "pi";

function extractMentions(input: string): MentionTarget[] {
  const found: MentionTarget[] = [];
  const seen = new Set<MentionTarget>();
  const pattern = /@(cloud|codex|claude|pi)\b/gi;
  for (const match of input.matchAll(pattern)) {
    const target = (match[1] ?? "").toLowerCase() as MentionTarget;
    if (!seen.has(target)) {
      seen.add(target);
      found.push(target);
    }
  }
  return found;
}

function toSpeakerName(target: MentionTarget): string {
  if (target === "cloud") return "Cloud";
  if (target === "codex") return "Codex";
  if (target === "claude") return "Claude";
  return "Pi";
}

function resolveMentionAgent(target: MentionTarget):
  | {
      ok: true;
      data: { id: string; name: string; sdk: string };
    }
  | {
      ok: false;
      error: string;
    } {
  const agents = getActiveAgents();
  const byIdOrName = (name: string) =>
    agents.find((agent) => {
      const id = agent.id.trim().toLowerCase();
      const label = agent.name.trim().toLowerCase();
      return id === name || label === name;
    });

  if (target === "cloud") {
    const namedCloud = byIdOrName("cloud");
    if (namedCloud) {
      if ((namedCloud.sdk ?? "pi") !== "openclaw") {
        return { ok: false, error: "@cloud agent must use openclaw sdk" };
      }
      return {
        ok: true,
        data: {
          id: namedCloud.id,
          name: namedCloud.name || "Cloud",
          sdk: namedCloud.sdk ?? "pi",
        },
      };
    }
    const openclaw = agents.find((agent) => (agent.sdk ?? "pi") === "openclaw");
    if (!openclaw) {
      return { ok: false, error: "No openclaw agent available for @cloud" };
    }
    return {
      ok: true,
      data: {
        id: openclaw.id,
        name: openclaw.name || "Cloud",
        sdk: openclaw.sdk ?? "pi",
      },
    };
  }

  const matched = byIdOrName(target);
  if (!matched) return { ok: false, error: `No agent found for @${target}` };
  return {
    ok: true,
    data: {
      id: matched.id,
      name: matched.name || toSpeakerName(target),
      sdk: matched.sdk ?? "pi",
    },
  };
}

function buildConversationInception(conversation: ConversationDetail): string {
  const participants = conversation.participants.length
    ? conversation.participants.join(", ")
    : "none";
  const tags = conversation.tags.length
    ? conversation.tags.map((tag) => `#${tag}`).join(" ")
    : "none";
  const attachments = conversation.attachments.length
    ? conversation.attachments.map((name) => `- ${name}`).join("\n")
    : "- none";
  const transcript = conversation.content.trim() || "_No transcript content._";

  return [
    "# Inception",
    "",
    "## Source conversation",
    `- id: ${conversation.id}`,
    `- title: ${conversation.title}`,
    `- date: ${conversation.date ?? "unknown"}`,
    `- source: ${conversation.source ?? "unknown"}`,
    `- participants: ${participants}`,
    `- tags: ${tags}`,
    "",
    "## Attachments",
    attachments,
    "",
    "## Transcript",
    transcript,
    "",
  ].join("\n");
}

function generateRalphLoopSlug(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `ralph-${now}-${rand}`;
}

const UpdateTaskRequestSchema = z.object({
  checked: z.boolean().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  agentId: z.union([z.string(), z.null()]).optional(),
});

const CreateTaskRequestSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
});

const PutSpecRequestSchema = z.object({
  content: z.string(),
});
const CommitProjectChangesRequestSchema = z.object({
  message: z.string(),
});

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

// GET /api/areas - list areas from YAML store
api.get("/areas", async (c) => {
  const config = getConfig();
  const areas = await listAreas(config);
  return c.json(areas);
});

// POST /api/areas - create area
api.post("/areas", async (c) => {
  const body = await c.req.json();
  const parsed = AreaSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }
  const config = getConfig();
  try {
    const area = await createArea(config, parsed.data);
    return c.json(area, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("Area already exists") ? 409 : 400;
    return c.json({ error: message }, status);
  }
});

// PATCH /api/areas/:id - update area
api.patch("/areas/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = AreaSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }
  const config = getConfig();
  try {
    const area = await updateArea(config, id, parsed.data);
    return c.json(area);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("Area not found") ? 404 : 400;
    return c.json({ error: message }, status);
  }
});

// DELETE /api/areas/:id - delete area file
api.delete("/areas/:id", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const deleted = await deleteArea(config, id);
  if (!deleted) {
    return c.json({ error: "Area not found" }, 404);
  }
  return c.json({ ok: true });
});

// POST /api/areas/migrate - seed defaults + infer project areas
api.post("/areas/migrate", async (c) => {
  const config = getConfig();
  const result = await migrateAreas(config);
  return c.json(result);
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
  const frontmatterRunAgentValue =
    typeof frontmatter.runAgent === "string" ? frontmatter.runAgent.trim() : "";
  const resolvedRunAgentValue =
    requestedRunAgentValue || frontmatterRunAgentValue || "cli:codex";
  const normalizedRunAgentValue = resolvedRunAgentValue.includes(":")
    ? resolvedRunAgentValue
    : `cli:${resolvedRunAgentValue}`;

  let runAgentSelection = normalizeRunAgent(normalizedRunAgentValue);
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

  let runMode: CliRunMode | undefined;
  let slug: string | undefined;
  let baseBranch: string | undefined;
  const requestedName =
    typeof parsed.data.name === "string" && parsed.data.name.trim()
      ? parsed.data.name.trim()
      : undefined;
  const requestedModel =
    typeof parsed.data.model === "string" && parsed.data.model.trim()
      ? parsed.data.model.trim()
      : undefined;
  const requestedReasoningEffort =
    typeof parsed.data.reasoningEffort === "string" &&
    parsed.data.reasoningEffort.trim()
      ? parsed.data.reasoningEffort.trim()
      : undefined;
  const requestedThinking =
    typeof parsed.data.thinking === "string" && parsed.data.thinking.trim()
      ? parsed.data.thinking.trim()
      : undefined;
  const requestedRunModeValue =
    typeof parsed.data.runMode === "string" ? parsed.data.runMode.trim() : "";
  const frontmatterRunModeValue =
    typeof frontmatter.runMode === "string" ? frontmatter.runMode.trim() : "";
  const resolvedRunModeValue =
    requestedRunModeValue || frontmatterRunModeValue || "clone";
  const resolvedRunMode = normalizeCliRunMode(resolvedRunModeValue);
  if (runAgentSelection.type === "cli") {
    runMode = resolvedRunMode;
    const requestedSlugValue =
      typeof parsed.data.slug === "string" ? parsed.data.slug.trim() : "";
    slug =
      runMode === "main-run"
        ? "main"
        : requestedSlugValue || slugifyTitle(project.title);
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
          : id === "pi"
            ? "Pi"
            : undefined;
  } else {
    runAgentLabel = getAgent(runAgentSelection.id)?.name;
  }

  const repo = typeof frontmatter.repo === "string" ? frontmatter.repo : "";
  let implementationRepo = repo;
  if (runMode && runMode !== "main-run" && slug) {
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

  if (!isSupportedSubagentCli(runAgentSelection.id)) {
    return c.json(
      { error: getUnsupportedSubagentCliError(runAgentSelection.id) },
      400
    );
  }
  const runCli = runAgentSelection.id;
  const resolvedCliOptions = resolveCliSpawnOptions(
    runCli,
    requestedModel,
    requestedReasoningEffort,
    requestedThinking
  );
  if (!resolvedCliOptions.ok) {
    return c.json({ error: resolvedCliOptions.error }, 400);
  }

  if (frontmatter.executionMode === "ralph_loop") {
    if (!["claude", "codex"].includes(runCli)) {
      return c.json(
        { error: `Unsupported CLI for ralph_loop: ${runCli}` },
        400
      );
    }
    const ralphCli = runCli as "claude" | "codex";

    const ralphIterationsRaw =
      typeof frontmatter.iterations === "number"
        ? frontmatter.iterations
        : Number(frontmatter.iterations);
    const ralphIterations =
      Number.isFinite(ralphIterationsRaw) && ralphIterationsRaw >= 1
        ? ralphIterationsRaw
        : 20;
    const ralphMode = resolvedRunMode;
    const ralphBaseBranch =
      typeof parsed.data.baseBranch === "string" &&
      parsed.data.baseBranch.trim()
        ? parsed.data.baseBranch.trim()
        : "main";
    const ralphSlug = generateRalphLoopSlug();

    const result = await spawnRalphLoop(config, {
      projectId: project.id,
      slug: ralphSlug,
      cli: ralphCli,
      iterations: ralphIterations,
      mode: ralphMode,
      baseBranch: ralphBaseBranch,
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

    return c.json({ ok: true, type: "ralph_loop", slug: ralphSlug });
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
    cli: runCli,
    name: requestedName,
    prompt,
    model: resolvedCliOptions.data.model,
    reasoningEffort: resolvedCliOptions.data.reasoningEffort,
    thinking: resolvedCliOptions.data.thinking,
    mode: runModeValue,
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

// GET /api/projects/:id/spec - read raw SPECS.md
api.get("/projects/:id/spec", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const project = await getProject(config, id);
  if (!project.ok) {
    return c.json({ error: project.error }, 404);
  }
  const content = await readSpec(config, id);
  return c.json({ content });
});

// PUT /api/projects/:id/spec - overwrite SPECS.md
api.put("/projects/:id/spec", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = PutSpecRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }
  const config = getConfig();
  const project = await getProject(config, id);
  if (!project.ok) {
    return c.json({ error: project.error }, 404);
  }
  await writeSpec(config, id, parsed.data.content);
  return c.json({ ok: true });
});

// GET /api/projects/:id/tasks - parse tasks from SPECS.md
api.get("/projects/:id/tasks", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const project = await getProject(config, id);
  if (!project.ok) {
    return c.json({ error: project.error }, 404);
  }
  const specs = await readSpec(config, id);
  const tasks = parseTasks(specs);
  const done = tasks.filter((task) => task.checked).length;
  return c.json({
    tasks,
    progress: { done, total: tasks.length },
  });
});

// POST /api/projects/:id/tasks - append task to ## Tasks
api.post("/projects/:id/tasks", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = CreateTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }
  const config = getConfig();
  const project = await getProject(config, id);
  if (!project.ok) {
    return c.json({ error: project.error }, 404);
  }

  const specs = await readSpec(config, id);
  const tasks = parseTasks(specs);
  const status = parsed.data.status ?? "todo";
  const checked = status === "done";
  tasks.push({
    title: parsed.data.title,
    description: parsed.data.description,
    status,
    checked,
    order: tasks.length,
  });
  const nextSpecs = serializeTasks(tasks, specs);
  await writeSpec(config, id, nextSpecs);
  return c.json({ task: tasks[tasks.length - 1] }, 201);
});

// PATCH /api/projects/:id/tasks/:order - update task state
api.patch("/projects/:id/tasks/:order", async (c) => {
  const id = c.req.param("id");
  const order = Number(c.req.param("order"));
  if (!Number.isInteger(order) || order < 0) {
    return c.json({ error: "Invalid task order" }, 400);
  }
  const body = await c.req.json();
  const parsed = UpdateTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }
  const config = getConfig();
  const project = await getProject(config, id);
  if (!project.ok) {
    return c.json({ error: project.error }, 404);
  }

  const specs = await readSpec(config, id);
  const tasks = parseTasks(specs);
  const task = tasks[order];
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  let checked = parsed.data.checked ?? task.checked;
  let status = parsed.data.status ?? task.status;
  if (parsed.data.checked !== undefined && parsed.data.status === undefined) {
    status = parsed.data.checked ? "done" : "todo";
  }
  if (parsed.data.status !== undefined && parsed.data.checked === undefined) {
    checked = parsed.data.status === "done";
  }

  const agentId =
    parsed.data.agentId === undefined
      ? task.agentId
      : parsed.data.agentId === null
        ? undefined
        : parsed.data.agentId;

  tasks[order] = {
    ...task,
    checked,
    status,
    agentId,
    order,
  };
  const nextSpecs = serializeTasks(tasks, specs);
  await writeSpec(config, id, nextSpecs);
  return c.json({ task: tasks[order] });
});

// DELETE /api/projects/:id/tasks/:order - remove a task
api.delete("/projects/:id/tasks/:order", async (c) => {
  const id = c.req.param("id");
  const order = Number(c.req.param("order"));
  if (!Number.isInteger(order) || order < 0) {
    return c.json({ error: "Invalid task order" }, 400);
  }
  const config = getConfig();
  const project = await getProject(config, id);
  if (!project.ok) {
    return c.json({ error: project.error }, 404);
  }

  const specs = await readSpec(config, id);
  const tasks = parseTasks(specs);
  if (!tasks[order]) {
    return c.json({ error: "Task not found" }, 404);
  }
  tasks.splice(order, 1);
  const nextSpecs = serializeTasks(tasks, specs);
  await writeSpec(config, id, nextSpecs);
  return c.json({ ok: true });
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

// GET /api/conversations - list conversations
api.get("/conversations", async (c) => {
  const config = getConfig();
  const result = await listConversations(config, {
    q: c.req.query("q"),
    source: c.req.query("source"),
    tag: c.req.query("tag"),
    participant: c.req.query("participant"),
  });
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.data);
});

// GET /api/conversations/:id - conversation detail
api.get("/conversations/:id", async (c) => {
  const config = getConfig();
  const result = await getConversation(config, c.req.param("id"));
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }
  return c.json(result.data);
});

// POST /api/conversations/:id/messages - append message and dispatch mentions
api.post("/conversations/:id/messages", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  const existing = await getConversation(config, id);
  if (!existing.ok) {
    return c.json({ error: existing.error }, 404);
  }

  const body = await c.req.json();
  const parsed = PostConversationMessageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const userMessage = parsed.data.message.trim();
  if (!userMessage) {
    return c.json({ error: "message is required" }, 400);
  }

  const userTimestamp = formatClockTime(new Date());
  const appendedUser = await appendConversationMessage(config, id, {
    speaker: "User",
    timestamp: userTimestamp,
    body: userMessage,
  });
  if (!appendedUser.ok) {
    return c.json({ error: appendedUser.error }, 400);
  }

  const mentions = extractMentions(userMessage);
  const forDispatch = await getConversation(config, id);
  if (!forDispatch.ok) {
    return c.json({ error: forDispatch.error }, 404);
  }
  const dispatchPrompt = [
    "Conversation thread context:",
    forDispatch.data.content.trim(),
    "",
    "Latest user message:",
    userMessage,
  ]
    .join("\n")
    .trim();
  const dispatches: Array<{
    mention: MentionTarget;
    status: "ok" | "error";
    agentId?: string;
    sdk?: string;
    error?: string;
    replies: string[];
  }> = [];

  for (const mention of mentions) {
    const resolved = resolveMentionAgent(mention);
    if (!resolved.ok) {
      dispatches.push({
        mention,
        status: "error",
        error: resolved.error,
        replies: [],
      });
      continue;
    }

    try {
      const run = await runAgent({
        agentId: resolved.data.id,
        message: dispatchPrompt,
        sessionKey: `conversation:${id}:${mention}`,
      });
      const replies = run.payloads
        .map((payload) => payload.text?.trim() ?? "")
        .filter(Boolean);

      for (const reply of replies) {
        const agentTimestamp = formatClockTime(new Date());
        const appendedReply = await appendConversationMessage(config, id, {
          speaker: resolved.data.name || toSpeakerName(mention),
          timestamp: agentTimestamp,
          body: reply,
        });
        if (!appendedReply.ok) {
          dispatches.push({
            mention,
            status: "error",
            agentId: resolved.data.id,
            sdk: resolved.data.sdk,
            error: appendedReply.error,
            replies: [],
          });
          continue;
        }
      }

      dispatches.push({
        mention,
        status: "ok",
        agentId: resolved.data.id,
        sdk: resolved.data.sdk,
        replies,
      });
    } catch (err) {
      dispatches.push({
        mention,
        status: "error",
        agentId: resolved.data.id,
        sdk: resolved.data.sdk,
        error: err instanceof Error ? err.message : String(err),
        replies: [],
      });
    }
  }

  const updated = await getConversation(config, id);
  if (!updated.ok) {
    return c.json({ error: updated.error }, 404);
  }

  return c.json({
    conversation: updated.data,
    mentions,
    dispatches,
    ui: {
      shouldRefresh: true,
      isThinking: false,
      pendingMentions: [],
    },
  });
});

// GET /api/conversations/:id/attachments/:name - fetch attachment
api.get("/conversations/:id/attachments/:name", async (c) => {
  const id = c.req.param("id");
  const name = c.req.param("name");
  const config = getConfig();
  const result = await resolveConversationAttachment(config, id, name);
  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  const type = attachmentContentType(result.data.name);
  c.header("Content-Type", type);
  return c.body(
    Readable.toWeb(createReadStream(result.data.path)) as ReadableStream
  );
});

// POST /api/conversations/:id/projects - create project from conversation
api.post("/conversations/:id/projects", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = CreateConversationProjectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const config = getConfig();
  const conversation = await getConversation(config, id);
  if (!conversation.ok) {
    return c.json({ error: conversation.error }, 404);
  }

  const nextTitle = parsed.data.title?.trim() || conversation.data.title;
  const created = await createProject(config, {
    title: nextTitle,
    status: "shaping",
  });
  if (!created.ok) {
    return c.json({ error: created.error }, 400);
  }

  const inception = buildConversationInception(conversation.data);
  const updated = await updateProject(config, created.data.id, {
    docs: { INCEPTION: inception },
  });
  if (!updated.ok) {
    return c.json({ error: updated.error }, 400);
  }

  const comment = await appendProjectComment(config, created.data.id, {
    author: "system",
    date: formatThreadDate(new Date()),
    body: `Created from conversation ${id}`,
  });
  if (!comment.ok) {
    return c.json({ error: comment.error }, 400);
  }
  await recordCommentActivity({
    actor: "system",
    projectId: created.data.id,
    commentExcerpt: `Created from conversation ${id}`,
  });

  return c.json(updated.data, 201);
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
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : undefined;
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : undefined;
  const reasoningEffort =
    typeof body.reasoningEffort === "string" && body.reasoningEffort.trim()
      ? body.reasoningEffort.trim()
      : undefined;
  const thinking =
    typeof body.thinking === "string" && body.thinking.trim()
      ? body.thinking.trim()
      : undefined;
  const baseBranch =
    typeof body.baseBranch === "string" ? body.baseBranch : undefined;
  const resume = typeof body.resume === "boolean" ? body.resume : undefined;
  const attachments = Array.isArray(body.attachments)
    ? (
        body.attachments as Array<{
          path?: unknown;
          mimeType?: unknown;
          filename?: unknown;
        }>
      ).filter(
        (a): a is { path: string; mimeType: string; filename?: string } =>
          typeof a.path === "string" && typeof a.mimeType === "string"
      )
    : undefined;

  if (!slug || !cli || !prompt) {
    return c.json({ error: "Missing required fields" }, 400);
  }
  if (!isSupportedSubagentCli(cli)) {
    return c.json({ error: getUnsupportedSubagentCliError(cli) }, 400);
  }
  const resolvedCliOptions = resolveCliSpawnOptions(
    cli,
    model,
    reasoningEffort,
    thinking
  );
  if (!resolvedCliOptions.ok) {
    return c.json({ error: resolvedCliOptions.error }, 400);
  }

  const config = getConfig();
  const result = await spawnSubagent(config, {
    projectId: id,
    slug,
    cli,
    name,
    prompt,
    model: resolvedCliOptions.data.model,
    reasoningEffort: resolvedCliOptions.data.reasoningEffort,
    thinking: resolvedCliOptions.data.thinking,
    mode: mode as "main-run" | "worktree" | "clone" | undefined,
    baseBranch,
    resume,
    attachments,
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
    mode: mode as "main-run" | "worktree" | "clone" | undefined,
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

// GET /api/projects/:id/changes - get git changes
api.get("/projects/:id/changes", async (c) => {
  const id = c.req.param("id");
  const config = getConfig();
  try {
    const result = await getProjectChanges(config, id);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      message === "Project repo not set" || message === "Not a git repository"
        ? 400
        : message.startsWith("Project not found")
          ? 404
          : 500;
    return c.json({ error: message }, status);
  }
});

// POST /api/projects/:id/commit - commit all project changes
api.post("/projects/:id/commit", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = CommitProjectChangesRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const config = getConfig();
  try {
    const result = await commitProjectChanges(config, id, parsed.data.message);
    if (!result.ok) {
      const status =
        result.error === "Project repo not set" ||
        result.error === "Not a git repository" ||
        result.error === "Nothing to commit"
          ? 400
          : result.error.startsWith("Project not found")
            ? 404
            : 500;
      return c.json({ error: result.error }, status);
    }
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      message === "Project repo not set" || message === "Not a git repository"
        ? 400
        : message.startsWith("Project not found")
          ? 404
          : 500;
    return c.json({ error: message }, status);
  }
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
