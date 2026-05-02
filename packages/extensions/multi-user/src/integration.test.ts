import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";

type EnvSnapshot = {
  aihubHome?: string;
  home?: string;
  userProfile?: string;
};

type AppDeps = {
  api: {
    fetch: (request: Request) => Response | Promise<Response>;
  };
  createAuthMiddleware: () => MiddlewareHandler;
  getRequestAuthContext: typeof import("./middleware.js").getRequestAuthContext;
  forwardAuthContextToRequest: typeof import("./middleware.js").forwardAuthContextToRequest;
};

const tempDirs: string[] = [];

afterEach(async () => {
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function createApiApp({
  api,
  createAuthMiddleware,
  getRequestAuthContext,
  forwardAuthContextToRequest,
}: AppDeps) {
  const app = new Hono();
  app.use("/api/*", createAuthMiddleware());
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
  return app;
}

async function createTempHome(): Promise<{
  dir: string;
  previousEnv: EnvSnapshot;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-multi-user-"));
  tempDirs.push(dir);

  const previousEnv: EnvSnapshot = {
    aihubHome: process.env.AIHUB_HOME,
    home: process.env.HOME,
    userProfile: process.env.USERPROFILE,
  };

  process.env.AIHUB_HOME = dir;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;

  return { dir, previousEnv };
}

function restoreEnv(previousEnv: EnvSnapshot) {
  if (previousEnv.aihubHome === undefined) delete process.env.AIHUB_HOME;
  else process.env.AIHUB_HOME = previousEnv.aihubHome;

  if (previousEnv.home === undefined) delete process.env.HOME;
  else process.env.HOME = previousEnv.home;

  if (previousEnv.userProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousEnv.userProfile;
}

describe("multi-user integration", () => {
  it("initializes Better Auth end-to-end and protects API routes", async () => {
    const { dir, previousEnv } = await createTempHome();

    try {
      await fs.writeFile(
        path.join(dir, "aihub.json"),
        JSON.stringify({
          version: 2,
          agents: [
            {
              id: "main",
              name: "Main",
              workspace: "~/agents/main",
              model: { provider: "anthropic", model: "claude" },
            },
          ],
          extensions: {
            multiUser: {
              enabled: true,
              oauth: {
                google: {
                  clientId: "client-id",
                  clientSecret: "client-secret",
                },
              },
              allowedDomains: ["example.com"],
              sessionSecret: "x".repeat(32),
            },
          },
        })
      );

      const { clearConfigCacheForTests, loadConfig } =
        await import("../../../../apps/gateway/src/config/index.js");
      clearConfigCacheForTests();

      const config = loadConfig();
      const { api } =
        await import("../../../../apps/gateway/src/server/api.core.js");
      const {
        createAuthMiddleware,
        getRequestAuthContext,
        forwardAuthContextToRequest,
      } = await import("./middleware.js");
      const { getAuthDbPath } = await import("./db.js");
      const { multiUserExtension, getMultiUserRuntime } =
        await import("./index.js");

      expect(
        multiUserExtension.validateConfig(config.extensions?.multiUser)
      ).toEqual({
        valid: true,
        errors: [],
      });

      multiUserExtension.registerRoutes(api as never);
      await multiUserExtension.start({
        getConfig: () => config,
        getDataDir: () => dir,
        getAgent: (agentId) =>
          config.agents.find((agent) => agent.id === agentId),
        getAgents: () => config.agents,
        isAgentActive: () => true,
        isAgentStreaming: () => false,
        resolveWorkspaceDir: () => "/tmp",
        runAgent: async () => ({
          payloads: [],
          meta: { durationMs: 0, sessionId: "session" },
        }),
        getSubagentTemplates: () => [],
        resolveSessionId: async () => undefined,
        getSessionEntry: async () => undefined,
        clearSessionEntry: async () => undefined,
        restoreSessionUpdatedAt: () => undefined,
        deleteSession: () => undefined,
        invalidateHistoryCache: async () => undefined,
        getSessionHistory: async () => [],
        subscribe: () => () => undefined,
        emit: () => undefined,
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      });

      const app = createApiApp({
        api,
        createAuthMiddleware,
        getRequestAuthContext,
        forwardAuthContextToRequest,
      });
      const authDbPath = getAuthDbPath(dir);
      const runtime = getMultiUserRuntime();

      expect(runtime).not.toBeNull();

      const authOkResponse = await app.request("/api/auth/ok");
      expect(authOkResponse.status).toBe(200);
      await expect(authOkResponse.json()).resolves.toEqual({ ok: true });

      await expect(fs.access(authDbPath)).resolves.toBeUndefined();

      const tables = runtime?.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toContain("agent_assignments");

      const meResponse = await app.request("/api/me");
      expect(meResponse.status).toBe(401);
      await expect(meResponse.json()).resolves.toEqual({
        error: "unauthorized",
      });

      const agentsResponse = await app.request("/api/agents");
      expect(agentsResponse.status).toBe(401);
      await expect(agentsResponse.json()).resolves.toEqual({
        error: "unauthorized",
      });

      await multiUserExtension.stop();
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("keeps single-user mode unauthenticated and skips sqlite setup", async () => {
    const { dir, previousEnv } = await createTempHome();

    try {
      await fs.writeFile(
        path.join(dir, "aihub.json"),
        JSON.stringify({
          version: 2,
          agents: [
            {
              id: "main",
              name: "Main",
              workspace: "~/agents/main",
              model: { provider: "anthropic", model: "claude" },
            },
          ],
        })
      );

      const { clearConfigCacheForTests, loadConfig } =
        await import("../../../../apps/gateway/src/config/index.js");
      clearConfigCacheForTests();

      const config = loadConfig();
      const { api } =
        await import("../../../../apps/gateway/src/server/api.core.js");
      const {
        createAuthMiddleware,
        getRequestAuthContext,
        forwardAuthContextToRequest,
      } = await import("./middleware.js");
      const { getAuthDbPath } = await import("./db.js");

      const app = createApiApp({
        api,
        createAuthMiddleware,
        getRequestAuthContext,
        forwardAuthContextToRequest,
      });

      const capabilitiesResponse = await app.request("/api/capabilities");
      expect(capabilitiesResponse.status).toBe(200);
      await expect(capabilitiesResponse.json()).resolves.toEqual({
        version: 2,
        extensions: {},
        agents: ["main"],
        multiUser: false,
      });

      const agentsResponse = await app.request("/api/agents");
      expect(agentsResponse.status).toBe(200);
      await expect(agentsResponse.json()).resolves.toEqual([
        {
          id: "main",
          name: "Main",
          model: { provider: "anthropic", model: "claude" },
          sdk: "pi",
          workspace: path.join(dir, "agents/main"),
          authMode: undefined,
          queueMode: "queue",
        },
      ]);

      await expect(fs.access(getAuthDbPath(dir))).rejects.toThrow();
      expect(config.extensions?.multiUser).toBeUndefined();
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("keeps auth modules unloaded in single-user mode", async () => {
    const { dir, previousEnv } = await createTempHome();

    try {
      await fs.writeFile(
        path.join(dir, "aihub.json"),
        JSON.stringify({
          version: 2,
          agents: [
            {
              id: "main",
              name: "Main",
              workspace: "~/agents/main",
              model: { provider: "anthropic", model: "claude" },
            },
          ],
        })
      );

      vi.doMock("./auth.js", () => {
        throw new Error("multi-user auth should stay unloaded");
      });
      vi.doMock("./db.js", () => {
        throw new Error("multi-user db should stay unloaded");
      });

      const { clearConfigCacheForTests, loadConfig } =
        await import("../../../../apps/gateway/src/config/index.js");
      clearConfigCacheForTests();

      const { loadExtensions } =
        await import("../../../../apps/gateway/src/extensions/registry.js");
      await loadExtensions(loadConfig());

      const { api } =
        await import("../../../../apps/gateway/src/server/api.core.js");
      await expect(
        import("../../../../apps/gateway/src/server/index.js")
      ).resolves.toHaveProperty("startServer");

      const response = await api.request("/capabilities");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        version: 2,
        // scheduler, heartbeat, and subagents load by default
        extensions: { scheduler: true, heartbeat: true, subagents: true },
        agents: ["main"],
        multiUser: false,
      });
    } finally {
      restoreEnv(previousEnv);
    }
  });
});
