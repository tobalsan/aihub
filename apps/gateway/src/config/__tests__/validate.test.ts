import { describe, expect, it } from "vitest";
import { GatewayConfigSchema, type Extension } from "@aihub/shared";
import { loadExtensions } from "../../extensions/registry.js";
import {
  logComponentSummary,
  prepareStartupConfig,
  resolveStartupConfig,
  validateStartupConfig,
} from "../validate.js";

describe("startup validation", () => {
  it("warns for missing agent extensions without failing startup", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(" "));
    };

    try {
      const config = GatewayConfigSchema.parse({
        version: 2,
        agents: [
          {
            id: "main",
            name: "Main",
            workspace: "~/agents/main",
            model: { provider: "anthropic", model: "claude" },
            extensions: {
              missing: {
                enabled: true,
              },
            },
          },
        ],
      });

      const extensions = await loadExtensions(config);
      // core runtime extensions are loaded by default even without explicit config
      await expect(validateStartupConfig(config, extensions)).resolves.toEqual({
        loaded: ["scheduler", "heartbeat"],
        skipped: [],
      });
      expect(
        warnings.filter((warning) => warning.startsWith("[extensions]"))
      ).toEqual([
        '[extensions] agent "main" references unknown extension "missing"',
      ]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("rejects duplicate agent ids", async () => {
    const config = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
        },
        {
          id: "main",
          name: "Main 2",
          workspace: "~/agents/main-2",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      extensions: {
        scheduler: { enabled: true, tickSeconds: 60 },
      },
    });

    const extensions = await loadExtensions(config);
    await expect(validateStartupConfig(config, extensions)).rejects.toThrow(
      'Duplicate agent id "main"'
    );
  });

  it("rejects unknown component agent references", async () => {
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
        discord: {
          enabled: true,
          token: "discord-token",
          channels: {
            "123": { agent: "missing" },
          },
        },
      },
    });

    const extensions = await loadExtensions(config);
    await expect(validateStartupConfig(config, extensions)).rejects.toThrow(
      'references unknown agent "missing"'
    );
  });

  it("returns loaded and skipped component summary", async () => {
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

    const extensions = await loadExtensions(config);
    await expect(validateStartupConfig(config, extensions)).resolves.toEqual({
      loaded: ["scheduler", "heartbeat"],
      skipped: [],
    });
  });

  it("logs component summary", () => {
    const info: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      info.push(args.join(" "));
    };

    try {
      logComponentSummary({ loaded: ["scheduler"], skipped: ["discord"] });
    } finally {
      console.log = original;
    }

    expect(info).toHaveLength(2);
  });

  it("returns a resolved runtime config", async () => {
    process.env.TEST_RUNTIME_SECRET = "resolved-value";

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
        discord: {
          enabled: true,
          token: "$env:TEST_RUNTIME_SECRET",
          channels: {
            "123": { agent: "main" },
          },
        },
      },
    });

    await expect(resolveStartupConfig(config)).resolves.toMatchObject({
      extensions: {
        discord: expect.objectContaining({
          token: "resolved-value",
        }),
      },
    });

    delete process.env.TEST_RUNTIME_SECRET;
  });

  it("fails early when an extension rejects agent config", async () => {
    const config = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          extensions: {
            sample: {
              enabled: true,
            },
          },
        },
      ],
      extensions: {},
    });
    const extension: Extension = {
      id: "sample",
      displayName: "Sample",
      description: "Sample extension",
      dependencies: [],
      configSchema: GatewayConfigSchema,
      routePrefixes: [],
      validateConfig: () => ({ valid: true, errors: [] }),
      validateAgentConfigs: () => ({
        valid: false,
        errors: ['Extension "sample" for agent "main" missing required secret "apiKey"'],
      }),
      registerRoutes: () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
      capabilities: () => [],
    };

    await expect(prepareStartupConfig(config, [extension])).rejects.toThrow(
      'Extension "sample" for agent "main" missing required secret "apiKey"'
    );
  });
});
