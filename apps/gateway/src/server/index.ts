import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { WebSocketServer, type WebSocket } from "ws";
import type { WsClientMessage, WsServerMessage } from "@aihub/shared";
import { api } from "./api.js";
import { loadConfig, getAgent, isAgentActive } from "../config/index.js";
import { runAgent, agentEventBus } from "../agents/index.js";
import { resolveSessionId, getSessionEntry } from "../sessions/index.js";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

app.route("/api", api);

app.get("/health", (c) => c.json({ ok: true }));

// Subscription store: Map<ws, { agentId, sessionKey }>
type Subscription = { agentId: string; sessionKey: string };
const subscriptions = new Map<WebSocket, Subscription>();

function handleWsConnection(ws: WebSocket) {
  ws.on("message", async (raw) => {
    let msg: WsClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendWs(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (msg.type === "subscribe") {
      const agent = getAgent(msg.agentId);
      if (!agent || !isAgentActive(msg.agentId)) {
        sendWs(ws, { type: "error", message: "Agent not found" });
        return;
      }
      subscriptions.set(ws, { agentId: msg.agentId, sessionKey: msg.sessionKey });
      return;
    }

    if (msg.type === "unsubscribe") {
      subscriptions.delete(ws);
      return;
    }

    if (msg.type === "send") {
      const agent = getAgent(msg.agentId);
      if (!agent || !isAgentActive(msg.agentId)) {
        sendWs(ws, { type: "error", message: "Agent not found" });
        return;
      }

      try {
        // Resolve sessionId from sessionKey if not explicitly provided
        let sessionId = msg.sessionId;
        let message = msg.message;
        if (!sessionId && msg.sessionKey) {
          const resolved = await resolveSessionId({
            agentId: msg.agentId,
            sessionKey: msg.sessionKey,
            message: msg.message,
          });
          sessionId = resolved.sessionId;
          message = resolved.message;
        }

        await runAgent({
          agentId: msg.agentId,
          message,
          sessionId: sessionId ?? "default",
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
      const entry = getSessionEntry(sub.agentId, sub.sessionKey);
      if (!entry || entry.sessionId !== event.sessionId) continue;

      // Forward the event (strip internal fields)
      const { agentId, sessionId, sessionKey, ...streamEvent } = event;
      sendWs(ws, streamEvent);

      // Also send history_updated on done so UI can refetch
      if (event.type === "done") {
        sendWs(ws, { type: "history_updated", agentId, sessionId });
      }
    }
  });
}

export function startServer(port?: number, host?: string) {
  const config = loadConfig();
  const resolvedPort = port ?? config.server?.port ?? 4000;
  const resolvedHost = host ?? config.server?.host ?? "127.0.0.1";

  console.log(`Starting gateway server on ${resolvedHost}:${resolvedPort}`);

  const server = serve({
    fetch: app.fetch,
    port: resolvedPort,
    hostname: resolvedHost,
  });

  // Attach WebSocket server to the HTTP server
  const wss = new WebSocketServer({ server: server as import("http").Server, path: "/ws" });
  wss.on("connection", handleWsConnection);

  // Start broadcasting events to subscribers
  setupEventBroadcast();

  return server;
}

export { app };
