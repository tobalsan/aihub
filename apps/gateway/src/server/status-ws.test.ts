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
  let server: ReturnType<typeof import("./index.js").startServer>;
  let port: number;
  let startServer: typeof import("./index.js").startServer;
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
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify(config, null, 2)
    );

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

    const received: Array<{ type: string; agentId: string; status: string }> =
      [];
    const receivePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          agentId?: string;
          status?: string;
        };
        if (msg.type === "status") {
          received.push({
            type: msg.type,
            agentId: msg.agentId ?? "",
            status: msg.status ?? "",
          });
          if (received.length === 2) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });

    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    ws.send(JSON.stringify({ type: "subscribeStatus" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const sessionId = `ws-${Date.now()}`;
    setSessionStreaming("status-agent", sessionId, true);
    setSessionStreaming("status-agent", sessionId, false);

    await receivePromise;

    const closePromise = new Promise<void>((resolve) =>
      ws.once("close", () => resolve())
    );
    ws.close();
    await closePromise;

    expect(received).toEqual([
      { type: "status", agentId: "status-agent", status: "streaming" },
      { type: "status", agentId: "status-agent", status: "idle" },
    ]);
  });
});

describe("gateway status websocket in multi-user mode", () => {
  let tmpDir: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  let server: ReturnType<typeof import("./index.js").startServer>;
  let port: number;
  let startServer: typeof import("./index.js").startServer;
  let setSessionStreaming: (
    agentId: string,
    sessionId: string,
    streaming: boolean
  ) => void;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-status-ws-mu-"));

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    const config = {
      agents: [
        {
          id: "allowed-agent",
          name: "Allowed Agent",
          workspace: "~/test",
          model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
        },
        {
          id: "blocked-agent",
          name: "Blocked Agent",
          workspace: "~/test",
          model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
        },
      ],
    };
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify(config, null, 2)
    );

    vi.resetModules();
    vi.doMock("../components/registry.js", async () => {
      const actual = await vi.importActual<
        typeof import("../components/registry.js")
      >("../components/registry.js");
      return {
        ...actual,
        getLoadedComponents: () => [{ id: "multiUser" }],
        isMultiUserLoaded: () => true,
        isComponentLoaded: (componentId: string) => componentId === "multiUser",
      };
    });
    vi.doMock("../components/multi-user/middleware.js", () => ({
      createAuthMiddleware:
        () => async (_c: unknown, next: () => Promise<void>) => {
          await next();
        },
      getRequestAuthContext: () => null,
      forwardAuthContextToRequest: (request: Request) => request,
      requireAgentAccess:
        () => async (_c: unknown, next: () => Promise<void>) => {
          await next();
        },
      hasAgentAccess: async (
        authContext: {
          user?: { role?: string };
          session?: { userId?: string };
        } | null,
        agentId: string
      ) => authContext?.user?.role === "admin" || agentId === "allowed-agent",
      validateWebSocketRequest: async (request: Request) => {
        const cookie = request.headers.get("cookie");
        if (cookie !== "session=allowed") return null;
        return {
          user: {
            id: "user-1",
            role: "user",
            approved: true,
          },
          session: {
            id: "session-1",
            userId: "user-1",
          },
        };
      },
    }));

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

  it("filters status updates to assigned agents", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { cookie: "session=allowed" },
    });

    const received: Array<{ type: string; agentId: string; status: string }> =
      [];
    const receivePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, 400);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          agentId?: string;
          status?: string;
        };
        if (msg.type === "status") {
          received.push({
            type: msg.type,
            agentId: msg.agentId ?? "",
            status: msg.status ?? "",
          });
        }
      });
      ws.on("error", reject);
    });

    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    ws.send(JSON.stringify({ type: "subscribeStatus" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const allowedSessionId = `allowed-${Date.now()}`;
    setSessionStreaming("allowed-agent", allowedSessionId, true);
    setSessionStreaming("allowed-agent", allowedSessionId, false);

    const blockedSessionId = `blocked-${Date.now()}`;
    setSessionStreaming("blocked-agent", blockedSessionId, true);
    setSessionStreaming("blocked-agent", blockedSessionId, false);

    await receivePromise;

    const closePromise = new Promise<void>((resolve) =>
      ws.once("close", () => resolve())
    );
    ws.close();
    await closePromise;

    expect(received).toEqual([
      { type: "status", agentId: "allowed-agent", status: "streaming" },
      { type: "status", agentId: "allowed-agent", status: "idle" },
    ]);
  });
});
