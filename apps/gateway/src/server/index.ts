import { serve } from "@hono/node-server";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { WebSocketServer, type WebSocket } from "ws";
import { resolveBindHost } from "@aihub/shared";
import type {
  WsClientMessage,
  WsServerMessage,
  GatewayBindMode,
  GatewayConfig,
} from "@aihub/shared";
import { api } from "./api.core.js";
import { connectorTools } from "./connector-tools.js";
import { internalTools } from "./internal-tools.js";
import {
  cleanupOrphanContainers,
  ensureAgentImage,
  ensureNetwork,
} from "../agents/container.js";
import { loadConfig, getAgent, isAgentActive } from "../config/index.js";
import { runAgent, agentEventBus } from "../agents/index.js";
import {
  getKnownExtensionRouteMetadata,
  isExtensionLoaded,
} from "../extensions/registry.js";
import {
  resolveSessionId,
  getSessionEntry,
  isAbortTrigger,
} from "../sessions/index.js";
import { invalidateResolvedHistoryFile } from "../history/store.js";
import { getSessionCurrentTurn, isStreaming } from "../agents/index.js";
import { normalizeInboundAttachments } from "../sdk/attachments.js";

type RequestAuthContext =
  import("@aihub/extension-multi-user").RequestAuthContext;

const app = new Hono();
const wsDebug = process.env.DEBUG?.includes("aihub:ws");

type ExtensionRouteMatcher = {
  extension: string;
  matches: (path: string) => boolean;
};

function routePrefixToMatcher(prefix: string): (path: string) => boolean {
  if (!prefix.includes(":")) {
    return (path) => path === prefix || path.startsWith(`${prefix}/`);
  }

  const pattern = prefix
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (segment.startsWith(":")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  const regex = new RegExp(`^${pattern}$`);
  return (path) => regex.test(path);
}

function buildExtensionRouteMatchers(): ExtensionRouteMatcher[] {
  return getKnownExtensionRouteMetadata().flatMap((extension) =>
    extension.routePrefixes.map((prefix) => ({
      extension: extension.id,
      matches: routePrefixToMatcher(prefix),
    }))
  );
}

const extensionRouteMatchers = buildExtensionRouteMatchers();

type MultiUserMiddlewareModule = typeof import("@aihub/extension-multi-user");

let multiUserMiddlewareModulePromise: Promise<MultiUserMiddlewareModule> | null =
  null;

function loadMultiUserMiddlewareModule(): Promise<MultiUserMiddlewareModule> {
  multiUserMiddlewareModulePromise ??= import("@aihub/extension-multi-user");
  return multiUserMiddlewareModulePromise;
}

function isExtensionEnabled(
  config: GatewayConfig,
  extensionId: string
): boolean {
  const extensionConfig =
    extensionId === "multiUser"
      ? config.extensions?.multiUser
      : config.extensions?.[
          extensionId as keyof NonNullable<GatewayConfig["extensions"]>
        ];
  if (
    extensionConfig &&
    typeof extensionConfig === "object" &&
    "enabled" in extensionConfig &&
    extensionConfig.enabled === false
  ) {
    return false;
  }
  if (isExtensionLoaded(extensionId)) return true;
  return !!extensionConfig && extensionConfig.enabled !== false;
}

app.use("*", cors());
app.use("*", logger());
app.route("/internal", internalTools);
app.route("/connectors", connectorTools);
app.use("/api/*", async (c, next) => {
  let config: GatewayConfig;
  try {
    config = loadConfig();
  } catch {
    await next();
    return;
  }

  const path = c.req.path;
  for (const matcher of extensionRouteMatchers) {
    if (!matcher.matches(path)) continue;
    if (isExtensionEnabled(config, matcher.extension)) break;
    return c.json(
      {
        error: "extension_disabled",
        extension: matcher.extension,
      },
      404
    );
  }

  await next();
});
app.use("/api/*", async (c, next) => {
  if (!isExtensionLoaded("multiUser")) {
    await next();
    return;
  }

  const { createAuthMiddleware } = await loadMultiUserMiddlewareModule();
  return createAuthMiddleware()(c, next);
});
app.use("/api/agents/:id", async (c, next) => {
  if (!isExtensionLoaded("multiUser")) {
    await next();
    return;
  }

  const { requireAgentAccess } = await loadMultiUserMiddlewareModule();
  return requireAgentAccess("id")(c, next);
});
app.use("/api/agents/:id/*", async (c, next) => {
  if (!isExtensionLoaded("multiUser")) {
    await next();
    return;
  }

  const { requireAgentAccess } = await loadMultiUserMiddlewareModule();
  return requireAgentAccess("id")(c, next);
});
if (process.env.AIHUB_DEV) {
  app.get("/api/debug/events", (c) =>
    c.json({ events: agentEventBus.getRecentEvents() })
  );
}

app.all("/api/*", async (c) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname.startsWith("/api/")
    ? url.pathname.slice(4)
    : url.pathname === "/api"
      ? "/"
      : url.pathname;
  url.pathname = pathname || "/";
  const request = new Request(url, c.req.raw);

  if (isExtensionLoaded("multiUser")) {
    const { forwardAuthContextToRequest, getRequestAuthContext } =
      await loadMultiUserMiddlewareModule();
    forwardAuthContextToRequest(request, getRequestAuthContext(c));
  }

  return api.fetch(request);
});

app.all("/hooks/*", async (c) => {
  if (!isExtensionLoaded("webhooks")) {
    return c.json({ error: "extension_disabled", extension: "webhooks" }, 404);
  }
  return api.fetch(c.req.raw);
});

app.get("/health", (c) => c.json({ ok: true }));

// Subscription store: Map<ws, { agentId, sessionKey }>
type Subscription = { agentId: string; sessionKey: string };
const subscriptions = new Map<WebSocket, Subscription>();
const connectedClients = new Set<WebSocket>();
const wsAuthContexts = new Map<WebSocket, RequestAuthContext>();

// Global status subscribers (for sidebar real-time updates)
const statusSubscribers = new Set<WebSocket>();

async function canAccessAgent(
  authContext: RequestAuthContext | null,
  agentId: string
): Promise<boolean> {
  if (!isExtensionLoaded("multiUser")) return true;
  if (!authContext) return false;
  const { hasAgentAccess } = await loadMultiUserMiddlewareModule();
  return hasAgentAccess(authContext, agentId);
}

function handleWsConnection(
  ws: WebSocket,
  request?: import("http").IncomingMessage & {
    authContext?: RequestAuthContext | null;
  }
) {
  connectedClients.add(ws);
  if (request?.authContext) {
    wsAuthContexts.set(ws, request.authContext);
  }

  ws.on("message", async (raw) => {
    let msg: WsClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendWs(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    const authContext = wsAuthContexts.get(ws) ?? null;

    if (msg.type === "subscribe") {
      const agent = getAgent(msg.agentId);
      if (!agent || !isAgentActive(msg.agentId)) {
        sendWs(ws, { type: "error", message: "Agent not found" });
        return;
      }
      if (!(await canAccessAgent(authContext, msg.agentId))) {
        sendWs(ws, { type: "error", message: "Forbidden" });
        return;
      }
      subscriptions.set(ws, {
        agentId: msg.agentId,
        sessionKey: msg.sessionKey,
      });
      const entry = await getSessionEntry(
        msg.agentId,
        msg.sessionKey,
        authContext?.session.userId
      );
      if (entry && isStreaming(msg.agentId, entry.sessionId)) {
        const turn = getSessionCurrentTurn(msg.agentId, entry.sessionId);
        if (turn) {
          sendWs(ws, {
            type: "active_turn",
            agentId: msg.agentId,
            sessionId: entry.sessionId,
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
          });
        }
      }
      return;
    }

    if (msg.type === "unsubscribe") {
      subscriptions.delete(ws);
      return;
    }

    if (msg.type === "subscribeStatus") {
      statusSubscribers.add(ws);
      return;
    }

    if (msg.type === "unsubscribeStatus") {
      statusSubscribers.delete(ws);
      return;
    }

    if (msg.type === "send") {
      const agent = getAgent(msg.agentId);
      if (!agent || !isAgentActive(msg.agentId)) {
        sendWs(ws, { type: "error", message: "Agent not found" });
        return;
      }
      if (!(await canAccessAgent(authContext, msg.agentId))) {
        sendWs(ws, { type: "error", message: "Forbidden" });
        return;
      }

      try {
        const userId = authContext?.session.userId;
        const attachments = await normalizeInboundAttachments(msg.attachments);
        // Handle /abort - skip session resolution to avoid creating new session
        if (isAbortTrigger(msg.message)) {
          await runAgent({
            agentId: msg.agentId,
            userId,
            message: msg.message,
            attachments,
            sessionId: msg.sessionId,
            sessionKey: msg.sessionKey,
            onEvent: (event) => sendWs(ws, event),
          });
          return;
        }

        // Resolve sessionId from sessionKey if not explicitly provided
        let sessionId = msg.sessionId;
        let message = msg.message;
        let isNewSession = false;
        let resolvedSession:
          | {
              sessionId: string;
              sessionKey?: string;
              message: string;
              isNew: boolean;
            }
          | undefined;
        if (!sessionId && msg.sessionKey) {
          const resolved = await resolveSessionId({
            agentId: msg.agentId,
            userId,
            sessionKey: msg.sessionKey,
            message: msg.message,
          });
          sessionId = resolved.sessionId;
          message = resolved.message;
          isNewSession = resolved.isNew;
          resolvedSession = {
            sessionId: resolved.sessionId,
            sessionKey: msg.sessionKey,
            message: resolved.message,
            isNew: resolved.isNew,
          };
        }

        // Handle session reset with empty message (e.g., /new command)
        if (isNewSession && !message.trim()) {
          invalidateResolvedHistoryFile(
            msg.agentId,
            sessionId ?? "default",
            userId
          );
          const introMessage =
            agent.introMessage ?? "New conversation started.";
          sendWs(ws, {
            type: "session_reset",
            sessionId: sessionId ?? "default",
          });
          sendWs(ws, { type: "text", data: introMessage });
          sendWs(ws, { type: "done", meta: { durationMs: 0 } });
          return;
        }

        await runAgent({
          agentId: msg.agentId,
          userId,
          message: msg.message,
          attachments,
          sessionId: msg.sessionId ?? (resolvedSession ? undefined : "default"),
          sessionKey: resolvedSession ? undefined : (msg.sessionKey ?? "main"),
          resolvedSession,
          thinkLevel: msg.thinkLevel,
          onEvent: (event) => sendWs(ws, event),
        });
      } catch (err) {
        sendWs(ws, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    sendWs(ws, { type: "error", message: "Unknown message type" });
  });

  ws.on("close", () => {
    subscriptions.delete(ws);
    statusSubscribers.delete(ws);
    connectedClients.delete(ws);
    wsAuthContexts.delete(ws);
  });
}

function sendWs(ws: WebSocket, event: WsServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

// Broadcast stream events to subscribers
function setupEventBroadcast() {
  agentEventBus.onStreamEvent((event) => {
    void (async () => {
      for (const [ws, sub] of subscriptions) {
        if (sub.agentId !== event.agentId) continue;

        const entry = await getSessionEntry(
          sub.agentId,
          sub.sessionKey,
          wsAuthContexts.get(ws)?.session.userId
        );
        if (!entry || entry.sessionId !== event.sessionId) continue;

        const { agentId, sessionId, ...streamEvent } = event;
        sendWs(ws, streamEvent);
        if (event.type === "done") {
          sendWs(ws, { type: "history_updated", agentId, sessionId });
        }
      }
    })();
  });

  // Broadcast status changes to all status subscribers
  agentEventBus.onStatusChange((event) => {
    if (wsDebug) {
      console.log(
        `[ws] statusChange: ${event.agentId} -> ${event.status} (${statusSubscribers.size} subscribers)`
      );
    }
    const statusMessage = {
      type: "status" as const,
      agentId: event.agentId,
      status: event.status,
    };

    void (async () => {
      const access = await Promise.all(
        [...statusSubscribers].map(async (ws) => ({
          ws,
          allowed: await canAccessAgent(
            wsAuthContexts.get(ws) ?? null,
            event.agentId
          ),
        }))
      );
      for (const { ws, allowed } of access) {
        if (!allowed) continue;
        sendWs(ws, statusMessage);
      }
    })();
  });

  agentEventBus.onFileChanged((event) => {
    if (wsDebug) {
      console.log(
        `[ws] fileChanged: ${event.projectId}/${event.file} (${connectedClients.size} clients)`
      );
    }
    for (const ws of connectedClients) {
      sendWs(ws, event);
    }
  });

  agentEventBus.onAgentChanged((event) => {
    if (wsDebug) {
      console.log(
        `[ws] agentChanged: ${event.projectId} (${connectedClients.size} clients)`
      );
    }
    for (const ws of connectedClients) {
      sendWs(ws, event);
    }
  });

  agentEventBus.on("subagent.changed", (event) => {
    if (wsDebug) {
      const payload = event as { runId?: string; status?: string };
      console.log(
        `[ws] subagentChanged: ${payload.runId ?? "unknown"} -> ${payload.status ?? "unknown"} (${connectedClients.size} clients)`
      );
    }
    for (const ws of connectedClients) {
      sendWs(ws, event as WsServerMessage);
    }
  });
}

function resolveGatewayBindHost(bind?: GatewayBindMode): string {
  const host = resolveBindHost(bind);
  if (bind === "tailnet" && host === "127.0.0.1") {
    console.warn(
      "[gateway] tailnet bind: no tailnet IP found, falling back to 127.0.0.1"
    );
  }
  return host;
}

function setupGracefulShutdown(server: ReturnType<typeof serve>): void {
  const shutdown = async () => {
    console.log("[gateway] Graceful shutdown initiated");
    try {
      cleanupOrphanContainers();
    } catch (error) {
      console.error("[gateway] Container cleanup failed:", error);
    }
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export function startServer(port?: number, host?: string) {
  const config = loadConfig();
  const hasSandboxAgents = config.agents.some(
    (agent) => agent.sandbox?.enabled
  );
  if (hasSandboxAgents) {
    const networkName = config.sandbox?.network?.name ?? "aihub-agents";
    const internal = config.sandbox?.network?.internal ?? true;
    try {
      ensureNetwork(networkName, internal);
      cleanupOrphanContainers();
      const images = new Set(
        config.agents
          .filter((a) => a.sandbox?.enabled)
          .map((a) => a.sandbox?.image ?? "aihub-agent:latest")
      );
      for (const image of images) {
        ensureAgentImage(image);
      }
      console.log("Container sandbox: network ready, orphans cleaned");
    } catch (error) {
      console.error("Container sandbox setup failed:", error);
    }
  }

  const resolvedPort = port ?? config.gateway?.port ?? 4000;
  // host arg > config.gateway.host > resolve from bind > default loopback
  const resolvedHost =
    host ??
    config.gateway?.host ??
    resolveGatewayBindHost(config.gateway?.bind);
  const nodeBin = path.dirname(process.execPath);
  if (nodeBin && !process.env.PATH?.split(path.delimiter).includes(nodeBin)) {
    process.env.PATH = `${nodeBin}${path.delimiter}${process.env.PATH ?? ""}`;
  }

  console.log(`Starting gateway server on ${resolvedHost}:${resolvedPort}`);
  process.env.AIHUB_GATEWAY_PORT = String(resolvedPort);

  const server = serve({
    fetch: app.fetch,
    port: resolvedPort,
    hostname: resolvedHost,
  });

  // Attach WebSocket server to the HTTP server
  const shouldValidateWs = isExtensionLoaded("multiUser");
  const wss = new WebSocketServer({
    server: server as import("http").Server,
    path: "/ws",
    verifyClient: shouldValidateWs
      ? (info, done) => {
          const request = new Request("http://localhost/ws", {
            headers: new Headers(info.req.headers as Record<string, string>),
          });

          loadMultiUserMiddlewareModule()
            .then(({ validateWebSocketRequest }) =>
              validateWebSocketRequest(request)
            )
            .then((authContext) => {
              (
                info.req as import("http").IncomingMessage & {
                  authContext?: RequestAuthContext | null;
                }
              ).authContext = authContext;
              done(!!authContext, authContext ? undefined : 401);
            })
            .catch(() => done(false, 401));
        }
      : undefined,
  });
  wss.on("connection", handleWsConnection);

  // Start broadcasting events to subscribers
  setupEventBroadcast();
  setupGracefulShutdown(server);

  return server;
}

export { app };
