import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { WebSocketServer, type WebSocket } from "ws";
import type { WsClientMessage, StreamEvent } from "@aihub/shared";
import { api } from "./api.js";
import { loadConfig, getAgent, isAgentActive } from "../config/index.js";
import { runAgent } from "../agents/index.js";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

app.route("/api", api);

app.get("/health", (c) => c.json({ ok: true }));

function handleWsConnection(ws: WebSocket) {
  ws.on("message", async (raw) => {
    let msg: WsClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendWs(ws, { type: "error", message: "Invalid JSON" });
      ws.close();
      return;
    }

    if (msg.type !== "send") {
      sendWs(ws, { type: "error", message: "Unknown message type" });
      ws.close();
      return;
    }

    const agent = getAgent(msg.agentId);
    if (!agent || !isAgentActive(msg.agentId)) {
      sendWs(ws, { type: "error", message: "Agent not found" });
      ws.close();
      return;
    }

    try {
      await runAgent({
        agentId: msg.agentId,
        message: msg.message,
        sessionId: msg.sessionId ?? "default",
        onEvent: (event: StreamEvent) => {
          sendWs(ws, event);
        },
      });
    } catch (err) {
      sendWs(ws, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    ws.close();
  });
}

function sendWs(ws: WebSocket, event: StreamEvent) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
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

  return server;
}

export { app };
