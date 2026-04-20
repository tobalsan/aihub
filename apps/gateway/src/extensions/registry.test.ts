import { describe, expect, it } from "vitest";
import { GatewayConfigSchema, type Extension } from "@aihub/shared";
import {
  getLoadedExtensions,
  getKnownExtensionRouteMetadata,
  isExtensionLoaded,
  loadExtensions,
  topoSort,
} from "./registry.js";

describe("extension registry", () => {
  it("sorts extensions by dependency order", () => {
    const result = topoSort([
      {
        id: "heartbeat",
        displayName: "Heartbeat",
        description: "Heartbeat",
        dependencies: ["scheduler"],
        configSchema: GatewayConfigSchema,
        routePrefixes: ["/api/agents/:id/heartbeat"],
        validateConfig: () => ({ valid: true, errors: [] }),
        registerRoutes: () => undefined,
        start: async () => undefined,
        stop: async () => undefined,
        capabilities: () => [],
      },
      {
        id: "scheduler",
        displayName: "Scheduler",
        description: "Scheduler",
        dependencies: [],
        configSchema: GatewayConfigSchema,
        routePrefixes: ["/api/schedules"],
        validateConfig: () => ({ valid: true, errors: [] }),
        registerRoutes: () => undefined,
        start: async () => undefined,
        stop: async () => undefined,
        capabilities: () => [],
      },
    ] as Extension[]);

    expect(result.map((extension) => extension.id)).toEqual([
      "scheduler",
      "heartbeat",
    ]);
  });

  it("loads enabled extensions and stores them globally", async () => {
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
        scheduler: { enabled: true, tickSeconds: 60 },
        heartbeat: { enabled: true },
      },
    });

    const result = await loadExtensions(config);

    expect(result.map((extension) => extension.id)).toEqual([
      "scheduler",
      "heartbeat",
    ]);
    expect(getLoadedExtensions().map((extension) => extension.id)).toEqual([
      "scheduler",
      "heartbeat",
    ]);
    expect(isExtensionLoaded("scheduler")).toBe(true);
    expect(isExtensionLoaded("multiUser")).toBe(false);
  });

  it("loads multiUser extension when enabled", async () => {
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
        multiUser: {
          enabled: true,
          oauth: {
            google: {
              clientId: "google-client-id",
              clientSecret: "google-client-secret",
            },
          },
          sessionSecret: "test-secret",
        },
      },
    });

    const result = await loadExtensions(config);

    // scheduler and heartbeat load by default even without explicit config
    expect(result.map((extension) => extension.id)).toEqual([
      "scheduler",
      "heartbeat",
      "multiUser",
    ]);
    expect(isExtensionLoaded("multiUser")).toBe(true);
  });

  it("loads webhooks extension when any agent has webhooks config", async () => {
    const config = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          webhooks: {
            notion: {
              prompt: "Handle $WEBHOOK_PAYLOAD",
            },
          },
        },
      ],
      extensions: {},
    });

    const result = await loadExtensions(config);

    expect(result.map((extension) => extension.id)).toContain("webhooks");
    expect(isExtensionLoaded("webhooks")).toBe(true);
  });

  it("fails on invalid extension config", async () => {
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
      extensions: {
        scheduler: { enabled: true, tickSeconds: "bad" },
      },
    };

    await expect(loadExtensions(config as never)).rejects.toThrow(
      'Extension "scheduler" config invalid'
    );
  });

  it("fails on missing dependencies", async () => {
    // Explicitly disable scheduler so heartbeat's dependency is missing
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
        heartbeat: { enabled: true },
        scheduler: { enabled: false },
      },
    });

    await expect(loadExtensions(config)).rejects.toThrow(
      'Extension "heartbeat" requires "scheduler" which is not enabled'
    );
  });

  it("returns known extension route metadata without loading extensions", () => {
    const extensions = getKnownExtensionRouteMetadata();
    const projects = extensions.find(
      (extension) => extension.id === "projects"
    );
    const heartbeat = extensions.find(
      (extension) => extension.id === "heartbeat"
    );
    const multiUser = extensions.find(
      (extension) => extension.id === "multiUser"
    );
    const webhooks = extensions.find(
      (extension) => extension.id === "webhooks"
    );

    expect(projects?.routePrefixes).toContain("/api/projects");
    expect(heartbeat?.routePrefixes).toContain("/api/agents/:id/heartbeat");
    expect(multiUser?.routePrefixes).toContain("/api/auth");
    expect(webhooks?.routePrefixes).toContain("/hooks");
  });
});
