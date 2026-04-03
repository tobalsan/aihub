import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { GatewayConfigSchema } from "@aihub/shared";
import { clearConnectors } from "@aihub/shared";
import { loadComponents } from "../../components/registry.js";
import {
  logComponentSummary,
  prepareStartupConfig,
  resolveStartupConfig,
  validateStartupConfig,
} from "../validate.js";

const require = createRequire(import.meta.url);

describe("startup validation", () => {
  it("warns for missing connectors without failing startup", async () => {
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
            connectors: {
              missing: {
                enabled: true,
              },
            },
          },
        ],
      });

      const components = await loadComponents(config);
      await expect(validateStartupConfig(config, components)).resolves.toEqual({
        loaded: [],
        skipped: [],
      });
      expect(warnings).toEqual([
        '[connectors] agent "main" references unknown connector "missing"',
      ]);
    } finally {
      console.warn = originalWarn;
      clearConnectors();
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
      components: {
        scheduler: { enabled: true, tickSeconds: 60 },
      },
    });

    const components = await loadComponents(config);
    await expect(validateStartupConfig(config, components)).rejects.toThrow(
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
      components: {
        discord: {
          enabled: true,
          token: "discord-token",
          channels: {
            "123": { agent: "missing" },
          },
        },
      },
    });

    const components = await loadComponents(config);
    await expect(validateStartupConfig(config, components)).rejects.toThrow(
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
      components: {
        scheduler: { enabled: true, tickSeconds: 60 },
        heartbeat: { enabled: true },
      },
    });

    const components = await loadComponents(config);
    await expect(validateStartupConfig(config, components)).resolves.toEqual({
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
      components: {
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
      components: {
        discord: expect.objectContaining({
          token: "resolved-value",
        }),
      },
    });

    delete process.env.TEST_RUNTIME_SECRET;
  });

  it("fails early when a connector is missing a required secret", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aihub-connectors-"));
    const sampleDir = path.join(root, "sample");
    const zodUrl = pathToFileURL(require.resolve("zod")).href;

    try {
      await mkdir(sampleDir);
      await writeFile(
        path.join(sampleDir, "package.json"),
        JSON.stringify({ type: "module" })
      );
      await writeFile(
        path.join(sampleDir, "index.js"),
        [
          `import { z } from ${JSON.stringify(zodUrl)};`,
          "export default {",
          '  id: "sample",',
          '  displayName: "Sample",',
          '  description: "Sample connector",',
          "  configSchema: z.object({ apiKey: z.string().optional() }),",
          "  requiredSecrets: ['apiKey'],",
          "  createTools: () => [],",
          "};",
        ].join("\n")
      );

      const config = GatewayConfigSchema.parse({
        version: 2,
        agents: [
          {
            id: "main",
            name: "Main",
            workspace: "~/agents/main",
            model: { provider: "anthropic", model: "claude" },
            connectors: {
              sample: {
                enabled: true,
              },
            },
          },
        ],
        connectors: {
          path: root,
        },
      });

      await expect(prepareStartupConfig(config, [])).rejects.toThrow(
        'Connector "sample" for agent "main" missing required secret "apiKey"'
      );
    } finally {
      clearConnectors();
      await rm(root, { recursive: true, force: true });
    }
  });
});
