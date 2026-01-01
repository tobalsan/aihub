import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { api } from "./api.js";
import { loadConfig } from "../config/index.js";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

app.route("/api", api);

app.get("/health", (c) => c.json({ ok: true }));

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

  return server;
}

export { app };
