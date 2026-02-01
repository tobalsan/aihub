import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

describe("gateway status websocket", () => {
  let tmpDir: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  let server: import("node:http").Server;
  let port: number;
  let startServer: (port?: number, host?: string) => import("node:http").Server;
  let setSessionStreaming: (
    agentId: string,
    sessionId: string,
    streaming: boolean
  ) => void;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-status-ws-"));

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    const config = {
      agents: [
        {
          id: "status-agent",
          name: "Status Agent",
          workspace: "~/test",
          model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
        },
      ],
    };
    await fs.writeFile(path.join(configDir, "aihub.json"), JSON.stringify(config, null, 2));

    vi.resetModules();
    const serverMod = await import("./index.js");
    const sessionsMod = await import("../agents/sessions.js");
    startServer = serverMod.startServer;
    setSessionStreaming = sessionsMod.setSessionStreaming;

    server = startServer(0, "127.0.0.1");
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve();
      server.once("listening", () => resolve());
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("broadcasts status updates to subscribers", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    const received: Array<{ type: string; agentId: string; status: string }> = [];
    const receivePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { type?: string; agentId?: string; status?: string };
        if (msg.type === "status") {
          received.push({ type: msg.type, agentId: msg.agentId ?? "", status: msg.status ?? "" });
          if (received.length === 2) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });

    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    ws.send(JSON.stringify({ type: "subscribeStatus" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sessionId = `ws-${Date.now()}`;
    setSessionStreaming("status-agent", sessionId, true);
    setSessionStreaming("status-agent", sessionId, false);

    await receivePromise;

    const closePromise = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.close();
    await closePromise;

    expect(received).toEqual([
      { type: "status", agentId: "status-agent", status: "streaming" },
      { type: "status", agentId: "status-agent", status: "idle" },
    ]);
  });
});
