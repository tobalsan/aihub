import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { resolveHomeDir } from "@aihub/shared";
import {
  getActiveAgents,
  getAgent,
  isAgentActive,
  loadConfig,
  resolveWorkspaceDir,
} from "../config/index.js";
import {
  isExtensionLoaded,
  getExtensionRuntime,
} from "../extensions/registry.js";
import {
  runAgent,
  getAllSessionsForAgent,
  getAgentStatuses,
  getSessionHistory,
  getFullSessionHistory,
  getSessionCurrentTurn,
  isStreaming,
} from "../agents/index.js";
import type { HistoryViewMode } from "@aihub/shared";
import { getSessionEntry, getSessionThinkLevel } from "../sessions/index.js";
import {
  saveUploadedFile,
  resolveUploadMimeType,
  getAllowedMimeTypes,
  MAX_UPLOAD_SIZE_BYTES,
  UploadTooLargeError,
  UploadTypeError,
} from "../media/upload.js";
import {
  getMediaFileMetadata,
  resolveMediaFilePath,
} from "../media/metadata.js";
import { normalizeRunRequest } from "./run-request.js";

const api = new Hono();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MultiUserApiDeps = {
  getForwardedAuthContext: typeof import("@aihub/extension-multi-user").getForwardedAuthContext;
  getAgentFilter: typeof import("@aihub/extension-multi-user").getAgentFilter;
};

let multiUserApiDepsPromise: Promise<MultiUserApiDeps> | null = null;

function loadMultiUserApiDeps(): Promise<MultiUserApiDeps> {
  multiUserApiDepsPromise ??= import("@aihub/extension-multi-user").then(
    (module) => ({
      getForwardedAuthContext: module.getForwardedAuthContext,
      getAgentFilter: module.getAgentFilter,
    })
  );
  return multiUserApiDepsPromise;
}

async function getRequestAuthContext(c: Context) {
  if (!isExtensionLoaded("multiUser")) return null;
  const { getForwardedAuthContext } = await loadMultiUserApiDeps();
  return getForwardedAuthContext(c.req.raw.headers);
}

async function getRequestUserId(c: Context): Promise<string | undefined> {
  return (await getRequestAuthContext(c))?.session.userId;
}

async function getVisibleAgents(c: Context) {
  const agents = getActiveAgents();
  if (!isExtensionLoaded("multiUser")) {
    return agents;
  }

  const authContext = await getRequestAuthContext(c);
  if (!authContext) return agents;

  const { getAgentFilter } = await loadMultiUserApiDeps();
  return getAgentFilter(authContext.user.id, authContext.user.role)(agents);
}

function contentDispositionFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}

api.get("/theme.css", async (c) => {
  const themePath = path.join(resolveHomeDir(), "theme.css");
  try {
    const css = await fs.readFile(themePath, "utf8");
    c.header("Content-Type", "text/css");
    c.header("Cache-Control", "no-cache");
    return c.body(css);
  } catch {
    return c.body(null, 204);
  }
});

api.get("/branding/logo", async (c) => {
  const logo = loadConfig().branding?.logo;
  if (!logo) return c.json({ error: "Not found" }, 404);
  const homeDir = resolveHomeDir();
  const filePath = path.resolve(homeDir, logo);
  if (!filePath.startsWith(homeDir)) {
    return c.json({ error: "Invalid path" }, 400);
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return c.json({ error: "Not found" }, 404);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";
    const stream = createReadStream(filePath);
    c.header("Content-Type", contentType);
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(Readable.toWeb(stream) as unknown as ReadableStream);
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

api.get("/capabilities", async (c) => {
  const runtime = getExtensionRuntime();
  const capabilities = runtime.getCapabilities();
  const extensions = capabilities.extensions;
  const isMultiUserEnabled = capabilities.multiUser;
  const authContext = isMultiUserEnabled ? await getRequestAuthContext(c) : null;
  const agents = await getVisibleAgents(c);
  const branding = loadConfig().branding;

  return c.json({
    version: 2,
    extensions,
    agents: agents.map((agent) => agent.id),
    multiUser: isMultiUserEnabled,
    home: capabilities.home,
    ...(isMultiUserEnabled && authContext
      ? {
          user: {
            id: authContext.user.id,
            name: authContext.user.name ?? null,
            email: authContext.user.email ?? null,
            role: authContext.user.role ?? null,
          },
        }
      : {}),
    ...(branding
      ? {
          branding: {
            name: branding.name,
            logo: branding.logo ? "/api/branding/logo" : undefined,
          },
        }
      : {}),
  });
});

/** Resolve avatar for API response: relative paths become /api/agents/:id/avatar */
function resolveAvatarForApi(
  avatar: string | undefined,
  agentId: string
): string | undefined {
  if (!avatar) return undefined;
  if (/^\p{Emoji}/u.test(avatar) && avatar.length <= 4) return avatar;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  return `/api/agents/${agentId}/avatar`;
}

// GET /api/agents - list all agents (respects single-agent mode)
api.get("/agents", async (c) => {
  const agents = await getVisibleAgents(c);
  return c.json(
    agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      avatar: resolveAvatarForApi(a.avatar, a.id),
      model: a.model,
      sdk: a.sdk ?? "pi",
      workspace: a.workspace ? resolveWorkspaceDir(a.workspace) : undefined,
      authMode: a.auth?.mode,
      queueMode: a.queueMode ?? "queue",
    }))
  );
});

// GET /api/agents/status - get all agent streaming statuses
api.get("/agents/status", async (c) => {
  const agents = await getVisibleAgents(c);
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
    description: agent.description,
    avatar: resolveAvatarForApi(agent.avatar, agent.id),
    model: agent.model,
    sdk: agent.sdk ?? "pi",
    workspace: agent.workspace
      ? resolveWorkspaceDir(agent.workspace)
      : undefined,
    authMode: agent.auth?.mode,
    queueMode: agent.queueMode ?? "queue",
  });
});

// GET /api/agents/:id/avatar - serve avatar image from workspace
api.get("/agents/:id/avatar", async (c) => {
  const agentId = c.req.param("id");
  const agent = getAgent(agentId);
  if (!agent || !isAgentActive(agentId) || !agent.avatar || !agent.workspace) {
    return c.json({ error: "Not found" }, 404);
  }
  const wsDir = resolveWorkspaceDir(agent.workspace);
  const filePath = path.resolve(wsDir, agent.avatar);
  // Prevent path traversal outside workspace
  if (!filePath.startsWith(wsDir)) {
    return c.json({ error: "Invalid path" }, 400);
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return c.json({ error: "Not found" }, 404);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";
    const stream = createReadStream(filePath);
    c.header("Content-Type", contentType);
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(Readable.toWeb(stream) as unknown as ReadableStream);
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
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

  try {
    const body = await c.req.json();
    const authContext = await getRequestAuthContext(c);
    const normalized = await normalizeRunRequest({
      agent,
      input: { agentId, ...body },
      authContext,
      extensionRuntime: getExtensionRuntime(),
      source: "web",
    });

    if (normalized.type === "validation_error") {
      return c.json({ error: normalized.message }, 400);
    }
    if (normalized.type === "immediate") {
      return c.json(normalized.result);
    }

    const result = await runAgent(normalized.params);
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
  const userId = await getRequestUserId(c);
  const entry = await getSessionEntry(agentId, sessionKey, userId);

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
      ? await getSessionThinkLevel(agentId, sessionKey, userId)
      : undefined;

  const streaming = isStreaming(agentId, entry.sessionId);
  const turn = streaming
    ? getSessionCurrentTurn(agentId, entry.sessionId)
    : null;
  const activeTurn = turn
    ? {
        // Once the user message is persisted to canonical history, omit it
        // from the active-turn snapshot so clients don't render it twice.
        userText: turn.userFlushed ? null : turn.userText,
        userTimestamp: turn.userTimestamp,
        startedAt: turn.startTimestamp,
        thinking: turn.thinkingText,
        text: turn.assistantText,
        toolCalls: turn.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.args,
          status: tc.status,
        })),
      }
    : null;

  return c.json({
    messages,
    sessionId: entry.sessionId,
    view,
    thinkingLevel,
    isStreaming: streaming,
    activeTurn,
  });
});

// POST /api/media/upload - upload a file (multipart/form-data)
api.post("/media/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return c.json(
        {
          error: `File exceeds the 25MB upload limit`,
          maxSize: MAX_UPLOAD_SIZE_BYTES,
        },
        413
      );
    }

    let mimeType: string;
    try {
      mimeType = resolveUploadMimeType(file.type, file.name);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : "Unsupported file",
          allowedTypes: getAllowedMimeTypes(),
        },
        400
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await saveUploadedFile(arrayBuffer, mimeType, file.name);

    return c.json(result);
  } catch (err) {
    if (err instanceof UploadTooLargeError) {
      return c.json(
        {
          error: "File exceeds the 25MB upload limit",
          maxSize: MAX_UPLOAD_SIZE_BYTES,
        },
        413
      );
    }
    if (err instanceof UploadTypeError) {
      return c.json(
        { error: err.message, allowedTypes: getAllowedMimeTypes() },
        400
      );
    }

    const message = err instanceof Error ? err.message : "Upload failed";
    return c.json({ error: message }, 500);
  }
});

// GET /api/media/download/:id - download a registered media file
api.get("/media/download/:id", async (c) => {
  const fileId = c.req.param("id");
  if (!UUID_RE.test(fileId)) {
    return c.json({ error: "File not found" }, 404);
  }

  const metadata = await getMediaFileMetadata(fileId);
  if (!metadata) {
    return c.json({ error: "File not found" }, 404);
  }

  try {
    const realFilePath = await resolveMediaFilePath(metadata);
    const stat = await fs.stat(realFilePath);

    c.header("Content-Type", metadata.mimeType);
    c.header("Content-Length", String(stat.size));
    c.header(
      "Content-Disposition",
      `attachment; filename="${contentDispositionFilename(metadata.filename)}"`
    );
    return c.body(
      Readable.toWeb(
        createReadStream(realFilePath)
      ) as unknown as ReadableStream
    );
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});

// GET /api/media/allowed-types - list allowed file types
api.get("/media/allowed-types", (c) => {
  return c.json({ types: getAllowedMimeTypes() });
});

export { api };
