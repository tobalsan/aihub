import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import { GatewayConfigSchema } from "@aihub/shared";

describe("extension route mounting", () => {
  let tmpDir: string;
  let extensions: Array<{
    id: string;
    registerRoutes: (api: unknown) => void;
    start?: (ctx: unknown) => Promise<void>;
    stop?: () => Promise<void>;
  }> = [];

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-component-routes-"));
    const projectsRoot = path.join(tmpDir, "projects");
    await fs.mkdir(projectsRoot, { recursive: true });

    vi.resetModules();
    const { clearConfigCacheForTests, setLoadedConfig } = await import("../config/index.js");
    clearConfigCacheForTests();
    const config = GatewayConfigSchema.parse({
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
        projects: { enabled: true, root: projectsRoot },
      },
    });
    setLoadedConfig(config);
    const { loadExtensions } = await import("../extensions/registry.js");
    const { api } = await import("./api.core.js");
    extensions = (await loadExtensions(config)) as typeof extensions;
    for (const extension of extensions) {
      extension.registerRoutes(api);
    }

    for (const extension of extensions) {
      if (extension.id === "projects") {
        await extension.start?.({
          getConfig: () => config,
          getDataDir: () => path.join(tmpDir, ".aihub"),
          getAgents: () => config.agents ?? [],
          getAgent: (id: string) => config.agents?.find((a) => a.id === id),
          isAgentActive: () => true,
          isAgentStreaming: () => false,
          resolveWorkspaceDir: () => tmpDir,
          runAgent: async () => ({ ok: true, data: {} }),
          getSubagentTemplates: () => [],
          resolveSessionId: async () => undefined,
          getSessionEntry: async () => undefined,
          clearSessionEntry: async () => undefined,
          restoreSessionUpdatedAt: () => {},
          deleteSession: () => {},
          invalidateHistoryCache: async () => {},
          getSessionHistory: async () => [],
          subscribe: () => () => {},
          emit: () => {},
          logger: console,
        });
      }
    }
  });

  afterAll(async () => {
    for (const extension of extensions) {
      await extension.stop?.();
    }
    const { clearConfigCacheForTests } = await import("../config/index.js");
    clearConfigCacheForTests();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("serves routes registered by enabled extensions through the main app", async () => {
    const { app } = await import("./index.js");

    const projectsResponse = await Promise.resolve(app.request("/api/projects"));
    expect(projectsResponse.status).toBe(200);
    await expect(projectsResponse.json()).resolves.toEqual(expect.any(Array));

  });
});
