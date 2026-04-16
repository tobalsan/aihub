import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { SendMessageRequestSchema } from "@aihub/shared";
import {
  getActiveAgents,
  getAgent,
  isAgentActive,
  resolveWorkspaceDir,
} from "../config/index.js";
import {
  getLoadedComponents,
  isComponentLoaded,
} from "../components/registry.js";
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
  MAX_UPLOAD_SIZE_BYTES,
  UploadTooLargeError,
} from "../media/upload.js";
import {
  getMediaInboundDir,
  getMediaOutboundDir,
  getMediaFileMetadata,
} from "../media/metadata.js";

const api = new Hono();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MultiUserApiDeps = {
  getForwardedAuthContext: typeof import("../components/multi-user/middleware.js").getForwardedAuthContext;
  getAgentFilter: typeof import("../components/multi-user/index.js").getAgentFilter;
};

let multiUserApiDepsPromise: Promise<MultiUserApiDeps> | null = null;

function loadMultiUserApiDeps(): Promise<MultiUserApiDeps> {
  multiUserApiDepsPromise ??= Promise.all([
    import("../components/multi-user/middleware.js"),
    import("../components/multi-user/index.js"),
  ]).then(([middlewareModule, componentModule]) => ({
    getForwardedAuthContext: middlewareModule.getForwardedAuthContext,
    getAgentFilter: componentModule.getAgentFilter,
  }));
  return multiUserApiDepsPromise;
}

async function getRequestAuthContext(c: Context) {
  if (!isComponentLoaded("multiUser")) return null;
  const { getForwardedAuthContext } = await loadMultiUserApiDeps();
  return getForwardedAuthContext(c.req.raw.headers);
}

async function getRequestUserId(c: Context): Promise<string | undefined> {
  return (await getRequestAuthContext(c))?.session.userId;
}

async function getVisibleAgents(c: Context) {
  const agents = getActiveAgents();
  if (!isComponentLoaded("multiUser")) {
    return agents;
  }

  const authContext = await getRequestAuthContext(c);
  if (!authContext) return agents;

  const { getAgentFilter } = await loadMultiUserApiDeps();
  return getAgentFilter(authContext.user.id, authContext.user.role)(agents);
}

function isWithinDir(filePath: string, dir: string): boolean {
  const relative = path.relative(dir, filePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function contentDispositionFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}

api.get("/capabilities", async (c) => {
  const components = Object.fromEntries(
    getLoadedComponents().map((component) => [component.id, true])
  );
  const multiUserEnabled = isComponentLoaded("multiUser");
  const authContext = multiUserEnabled ? await getRequestAuthContext(c) : null;
  const agents = await getVisibleAgents(c);

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
api.get("/agents", async (c) => {
  const agents = await getVisibleAgents(c);
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
    const userId = await getRequestUserId(c);
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

    let resolvedSession:
      | {
          sessionId: string;
          sessionKey?: string;
          message: string;
          isNew: boolean;
        }
      | undefined;
    if (!parsed.data.sessionId && parsed.data.sessionKey) {
      const resolved = await resolveSessionId({
        agentId: agent.id,
        userId,
        sessionKey: parsed.data.sessionKey,
        message: parsed.data.message,
      });
      resolvedSession = {
        sessionId: resolved.sessionId,
        sessionKey: parsed.data.sessionKey,
        message: resolved.message,
        isNew: resolved.isNew,
      };
    }

    const result = await runAgent({
      agentId: agent.id,
      userId,
      message: parsed.data.message,
      sessionId: parsed.data.sessionId,
      sessionKey: resolvedSession
        ? undefined
        : (parsed.data.sessionKey ?? "main"),
      resolvedSession,
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
    if (err instanceof UploadTooLargeError) {
      return c.json(
        {
          error: "File exceeds the 25MB upload limit",
          maxSize: MAX_UPLOAD_SIZE_BYTES,
        },
        413
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

  if (path.basename(metadata.storedFilename) !== metadata.storedFilename) {
    return c.json({ error: "File not found" }, 404);
  }

  const baseDir =
    metadata.direction === "outbound"
      ? getMediaOutboundDir()
      : getMediaInboundDir();
  const candidatePath = path.join(baseDir, metadata.storedFilename);

  try {
    const [realBaseDir, realFilePath] = await Promise.all([
      fs.realpath(baseDir),
      fs.realpath(candidatePath),
    ]);

    if (!isWithinDir(realFilePath, realBaseDir)) {
      return c.json({ error: "File not found" }, 404);
    }

    const stat = await fs.stat(realFilePath);
    if (!stat.isFile()) {
      return c.json({ error: "File not found" }, 404);
    }

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
