import { serve } from "@hono/node-server";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  WsClientMessage,
  WsServerMessage,
  GatewayBindMode,
  GatewayConfig,
} from "@aihub/shared";
import { api } from "./api.core.js";
import { loadConfig, getAgent, isAgentActive } from "../config/index.js";
import { runAgent, agentEventBus } from "../agents/index.js";
import {
  getKnownComponentRouteMetadata,
  getLoadedComponents,
} from "../components/registry.js";
import {
  resolveSessionId,
  getSessionEntry,
  isAbortTrigger,
} from "../sessions/index.js";
import {
  createAuthMiddleware,
  forwardAuthContextToRequest,
  getRequestAuthContext,
  hasAgentAccess,
  requireAgentAccess,
  validateWebSocketRequest,
  type RequestAuthContext,
} from "../components/multi-user/middleware.js";

const app = new Hono();

type ComponentRouteMatcher = {
  component: string;
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

function buildComponentRouteMatchers(): ComponentRouteMatcher[] {
  return getKnownComponentRouteMetadata().flatMap((component) =>
    component.routePrefixes.map((prefix) => ({
      component: component.id,
      matches: routePrefixToMatcher(prefix),
    }))
  );
}

const componentRouteMatchers = buildComponentRouteMatchers();

function isComponentEnabled(
  config: GatewayConfig,
  componentId: string
): boolean {
  const componentConfig =
    componentId === "multiUser"
      ? config.multiUser
      : config.components?.[
          componentId as keyof NonNullable<GatewayConfig["components"]>
        ];
  return !!componentConfig && componentConfig.enabled !== false;
}

app.use("*", cors());
app.use("*", logger());
app.use("/api/*", async (c, next) => {
  let config: GatewayConfig;
  try {
    config = loadConfig();
  } catch {
    await next();
    return;
  }

  const path = c.req.path;
  for (const matcher of componentRouteMatchers) {
    if (!matcher.matches(path)) continue;
    if (isComponentEnabled(config, matcher.component)) break;
    return c.json(
      {
        error: "component_disabled",
        component: matcher.component,
      },
      404
    );
  }

  await next();
});
app.use("/api/*", createAuthMiddleware());
app.use("/api/agents/:id", requireAgentAccess("id"));
app.use("/api/agents/:id/*", requireAgentAccess("id"));

app.all("/api/*", (c) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname.startsWith("/api/")
    ? url.pathname.slice(4)
    : url.pathname === "/api"
      ? "/"
      : url.pathname;
  url.pathname = pathname || "/";
  const request = new Request(url, c.req.raw);
  forwardAuthContextToRequest(request, getRequestAuthContext(c));
  return api.fetch(request);
});

app.get("/health", (c) => c.json({ ok: true }));

// Subscription store: Map<ws, { agentId, sessionKey }>
type Subscription = { agentId: string; sessionKey: string };
const subscriptions = new Map<WebSocket, Subscription>();
const connectedClients = new Set<WebSocket>();
const wsAuthContexts = new Map<WebSocket, RequestAuthContext>();

// Global status subscribers (for sidebar real-time updates)
const statusSubscribers = new Set<WebSocket>();

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
      if (!(await hasAgentAccess(authContext, msg.agentId))) {
        sendWs(ws, { type: "error", message: "Forbidden" });
        return;
      }
      subscriptions.set(ws, {
        agentId: msg.agentId,
        sessionKey: msg.sessionKey,
      });
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
      if (!(await hasAgentAccess(authContext, msg.agentId))) {
        sendWs(ws, { type: "error", message: "Forbidden" });
        return;
      }

      try {
        const userId = authContext?.session.userId;
        // Handle /abort - skip session resolution to avoid creating new session
        if (isAbortTrigger(msg.message)) {
          await runAgent({
            agentId: msg.agentId,
            userId,
            message: msg.message,
            attachments: msg.attachments,
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
        }

        // Handle session reset with empty message (e.g., /new command)
        if (isNewSession && !message.trim()) {
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
          message,
          attachments: msg.attachments,
          sessionId: sessionId ?? "default",
          sessionKey: msg.sessionKey ?? "main",
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
    for (const [ws, sub] of subscriptions) {
      if (sub.agentId !== event.agentId) continue;

      // Match by sessionKey: resolve current sessionId for the key
      const entry = getSessionEntry(
        sub.agentId,
        sub.sessionKey,
        wsAuthContexts.get(ws)?.session.userId
      );
      if (!entry || entry.sessionId !== event.sessionId) continue;

      // Forward the event (strip internal fields)
      const { agentId, sessionId, ...streamEvent } = event;
      sendWs(ws, streamEvent);

      // Also send history_updated on done so UI can refetch
      if (event.type === "done") {
        sendWs(ws, { type: "history_updated", agentId, sessionId });
      }
    }
  });

  // Broadcast status changes to all status subscribers
  agentEventBus.onStatusChange((event) => {
    const statusMessage = {
      type: "status" as const,
      agentId: event.agentId,
      status: event.status,
    };
    for (const ws of statusSubscribers) {
      sendWs(ws, statusMessage);
    }
  });

  agentEventBus.onFileChanged((event) => {
    for (const ws of connectedClients) {
      sendWs(ws, event);
    }
  });

  agentEventBus.onAgentChanged((event) => {
    for (const ws of connectedClients) {
      sendWs(ws, event);
    }
  });
}

/**
 * Scan network interfaces for tailnet IPv4 (100.64.0.0/10)
 */
function pickTailnetIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const octets = addr.address.split(".").map(Number);
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
        return addr.address;
      }
    }
  }
  return null;
}

/**
 * Fallback: get tailnet IP from tailscale status --json
 */
function getTailscaleIP(): string | null {
  try {
    const output = execSync("tailscale status --json", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const status = JSON.parse(output);
    const ips = status?.Self?.TailscaleIPs as string[] | undefined;
    return ips?.find((ip: string) => !ip.includes(":")) ?? ips?.[0] ?? null;
  } catch {
    return null;
  }
}

function resolveBindHost(bind?: GatewayBindMode): string {
  if (!bind || bind === "loopback") return "127.0.0.1";
  if (bind === "lan") return "0.0.0.0";
  if (bind === "tailnet") {
    const ip = pickTailnetIPv4() ?? getTailscaleIP();
    if (ip) return ip;
    console.warn(
      "[gateway] tailnet bind: no tailnet IP found, falling back to 127.0.0.1"
    );
    return "127.0.0.1";
  }
  return "127.0.0.1";
}

export function startServer(port?: number, host?: string) {
  const config = loadConfig();
  const resolvedPort = port ?? config.gateway?.port ?? 4000;
  // host arg > config.gateway.host > resolve from bind > default loopback
  const resolvedHost =
    host ?? config.gateway?.host ?? resolveBindHost(config.gateway?.bind);
  const nodeBin = path.dirname(process.execPath);
  if (nodeBin && !process.env.PATH?.split(path.delimiter).includes(nodeBin)) {
    process.env.PATH = `${nodeBin}${path.delimiter}${process.env.PATH ?? ""}`;
  }

  console.log(`Starting gateway server on ${resolvedHost}:${resolvedPort}`);

  const server = serve({
    fetch: app.fetch,
    port: resolvedPort,
    hostname: resolvedHost,
  });

  // Attach WebSocket server to the HTTP server
  const shouldValidateWs = getLoadedComponents().some(
    (component) => component.id === "multiUser"
  );
  const wss = new WebSocketServer({
    server: server as import("http").Server,
    path: "/ws",
    verifyClient: shouldValidateWs
      ? (info, done) => {
          const request = new Request("http://localhost/ws", {
            headers: new Headers(info.req.headers as Record<string, string>),
          });

          validateWebSocketRequest(request)
            .then((authContext) => {
              (info.req as import("http").IncomingMessage & {
                authContext?: RequestAuthContext | null;
              }).authContext = authContext;
              done(!!authContext, authContext ? undefined : 401);
            })
            .catch(() => done(false, 401));
        }
      : undefined,
  });
  wss.on("connection", handleWsConnection);

  // Start broadcasting events to subscribers
  setupEventBroadcast();

  return server;
}

export { app };
