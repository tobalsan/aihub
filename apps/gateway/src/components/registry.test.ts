import { describe, expect, it } from "vitest";
import { GatewayConfigSchema } from "@aihub/shared";
import { getLoadedComponents, loadComponents, topoSort } from "./registry.js";

describe("component registry", () => {
  it("sorts components by dependency order", () => {
    const result = topoSort([
      {
        id: "heartbeat",
        displayName: "Heartbeat",
        dependencies: ["scheduler"],
        requiredSecrets: [],
        validateConfig: () => ({ valid: true, errors: [] }),
        registerRoutes: () => undefined,
        start: async () => undefined,
        stop: async () => undefined,
        capabilities: () => [],
      },
      {
        id: "scheduler",
        displayName: "Scheduler",
        dependencies: [],
        requiredSecrets: [],
        validateConfig: () => ({ valid: true, errors: [] }),
        registerRoutes: () => undefined,
        start: async () => undefined,
        stop: async () => undefined,
        capabilities: () => [],
      },
    ]);

    expect(result.map((component) => component.id)).toEqual([
      "scheduler",
      "heartbeat",
    ]);
  });

  it("loads enabled components and stores them globally", async () => {
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
      components: {
        scheduler: { enabled: true, tickSeconds: 60 },
        heartbeat: { enabled: true },
        amsg: { enabled: false },
      },
    });

    const result = await loadComponents(config);

    expect(result.map((component) => component.id)).toEqual([
      "scheduler",
      "heartbeat",
    ]);
    expect(getLoadedComponents().map((component) => component.id)).toEqual([
      "scheduler",
      "heartbeat",
    ]);
  });

  it("fails on invalid component config", async () => {
    const config = {
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      components: {
        scheduler: { enabled: true, tickSeconds: "bad" },
      },
    };

    await expect(loadComponents(config as never)).rejects.toThrow(
      'Component "scheduler" config invalid'
    );
  });

  it("fails on missing dependencies", async () => {
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
      components: {
        heartbeat: { enabled: true },
      },
    });

    await expect(loadComponents(config)).rejects.toThrow(
      'Component "heartbeat" requires "scheduler" which is not enabled'
    );
  });
});
