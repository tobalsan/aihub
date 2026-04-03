import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { migrateConfigV1toV2 } from "../config-migrate.js";
import { discoverExternalConnectors } from "../connectors/discovery.js";
import {
  loadConnectorTools,
  resolveConnectorConfig,
} from "../connectors/loader.js";
import {
  clearConnectors,
  getConnector,
  listConnectors,
  registerConnector,
} from "../connectors/registry.js";
import {
  ConnectorToolSchema,
  type ConnectorDefinition,
} from "../connectors/types.js";
import { AgentConfigSchema, GatewayConfigSchema } from "../types.js";

const require = createRequire(import.meta.url);

describe("connector registry", () => {
  beforeEach(() => {
    clearConnectors();
  });

  afterEach(() => {
    clearConnectors();
  });

  it("registers, gets, lists, and clears connectors", () => {
    const connector: ConnectorDefinition = {
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({}).passthrough(),
      requiredSecrets: [],
      createTools: () => [],
    };

    registerConnector(connector);

    expect(getConnector("sample")).toBe(connector);
    expect(listConnectors()).toEqual([connector]);

    clearConnectors();

    expect(getConnector("sample")).toBeUndefined();
    expect(listConnectors()).toEqual([]);
  });

  it("overrides an existing connector with the same id", () => {
    const first: ConnectorDefinition = {
      id: "sample",
      displayName: "First",
      description: "First connector",
      configSchema: z.object({}).passthrough(),
      requiredSecrets: [],
      createTools: () => [],
    };
    const second: ConnectorDefinition = {
      ...first,
      displayName: "Second",
    };

    registerConnector(first);
    registerConnector(second);

    expect(getConnector("sample")?.displayName).toBe("Second");
    expect(listConnectors()).toHaveLength(1);
  });
});

describe("connector loader", () => {
  beforeEach(() => {
    clearConnectors();
  });

  afterEach(() => {
    clearConnectors();
  });

  it("merges global and agent config, strips enabled, and namespaces tools", () => {
    let receivedConfig:
      | {
          global: Record<string, unknown>;
          agent: Record<string, unknown>;
          merged: Record<string, unknown>;
        }
      | undefined;

    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({
        token: z.string(),
        region: z.string(),
      }),
      agentConfigSchema: z.object({
        region: z.string(),
      }),
      requiredSecrets: [],
      createTools: (config) => {
        receivedConfig = config;
        return [
          {
            name: "ping",
            description: "Ping",
            parameters: z.object({}),
            execute: async () => "pong",
          },
        ];
      },
    });

    const resolved = resolveConnectorConfig(
      "sample",
      { token: "global-token", region: "us" },
      { region: "eu" }
    );
    const tools = loadConnectorTools(
      "sample",
      {
        path: "~/.aihub/connectors",
        sample: { token: "global-token", region: "us" },
      },
      {
        sample: { enabled: true, region: "eu" },
      }
    );

    expect(resolved).toEqual({
      global: { token: "global-token", region: "us" },
      agent: { region: "eu" },
      merged: { token: "global-token", region: "eu" },
    });
    expect(receivedConfig).toEqual(resolved);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("sample.ping");
  });

  it("returns no tools when the connector is missing or disabled", () => {
    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({}).passthrough(),
      requiredSecrets: [],
      createTools: () => [
        {
          name: "ping",
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        },
      ],
    });

    expect(loadConnectorTools("missing", {}, {})).toEqual([]);
    expect(
      loadConnectorTools(
        "sample",
        { sample: {} },
        { sample: { enabled: false } }
      )
    ).toEqual([]);
  });

  it("throws on invalid merged config", () => {
    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({
        token: z.string(),
      }),
      requiredSecrets: [],
      createTools: () => [],
    });

    expect(() =>
      loadConnectorTools(
        "sample",
        { sample: {} },
        { sample: { enabled: true } }
      )
    ).toThrow();
  });

  it("throws on invalid agent override config", () => {
    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({ token: z.string() }),
      agentConfigSchema: z.object({ region: z.string() }),
      requiredSecrets: [],
      createTools: () => [],
    });

    expect(() =>
      loadConnectorTools(
        "sample",
        { sample: { token: "global-token" } },
        { sample: { enabled: true, region: 1 } }
      )
    ).toThrow();
  });

  it("requires connector tool parameters to be object schemas", () => {
    expect(() =>
      ConnectorToolSchema.parse({
        name: "ping",
        description: "Ping",
        parameters: z.string(),
        execute: async () => "pong",
      })
    ).toThrow("Expected Zod object schema");

    expect(
      ConnectorToolSchema.parse({
        name: "ping",
        description: "Ping",
        parameters: z.object({ id: z.string() }),
        execute: async () => "pong",
      }).parameters
    ).toBeInstanceOf(z.ZodObject);
  });
});

describe("connector discovery", () => {
  beforeEach(() => {
    clearConnectors();
  });

  afterEach(async () => {
    clearConnectors();
  });

  it("registers valid external connectors and warns on invalid ones", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aihub-connectors-"));
    const validDir = path.join(root, "valid");
    const invalidDir = path.join(root, "invalid");
    const zodUrl = pathToFileURL(require.resolve("zod")).href;
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await mkdir(validDir);
      await mkdir(invalidDir);
      await writeFile(
        path.join(validDir, "package.json"),
        JSON.stringify({ type: "module" })
      );
      await writeFile(
        path.join(invalidDir, "package.json"),
        JSON.stringify({ type: "module" })
      );
      await writeFile(
        path.join(validDir, "index.js"),
        [
          `import { z } from ${JSON.stringify(zodUrl)};`,
          "export default {",
          '  id: "external",',
          '  displayName: "External",',
          '  description: "External connector",',
          "  configSchema: z.object({ apiKey: z.string() }),",
          "  requiredSecrets: [],",
          "  createTools: () => [],",
          "};",
        ].join("\n")
      );
      await writeFile(
        path.join(invalidDir, "index.js"),
        'export default { id: 123, displayName: "Invalid" };'
      );

      await discoverExternalConnectors(root);

      expect(getConnector("external")?.displayName).toBe("External");
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores missing connector directories", async () => {
    await expect(
      discoverExternalConnectors(
        path.join(os.tmpdir(), "missing-connectors-dir")
      )
    ).resolves.toBeUndefined();
  });
});

describe("connector config schemas", () => {
  it("accepts gateway connectors config", () => {
    const result = GatewayConfigSchema.parse({
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          connectors: {
            hiveage: {
              enabled: true,
              subdomain: "cloudi-fi",
            },
          },
        },
      ],
      connectors: {
        path: "~/.aihub/connectors",
        hiveage: {
          apiKey: "$secret:hiveage_api_key",
        },
      },
    });

    expect(result.connectors?.path).toBe("~/.aihub/connectors");
    expect(result.agents[0]?.connectors?.hiveage?.subdomain).toBe("cloudi-fi");
  });

  it("accepts agent connectors config", () => {
    const result = AgentConfigSchema.parse({
      id: "main",
      name: "Main",
      workspace: "~/agents/main",
      model: { provider: "anthropic", model: "claude" },
      connectors: {
        zendesk: {
          enabled: true,
          brandId: "123",
        },
      },
    });

    expect(result.connectors?.zendesk?.brandId).toBe("123");
  });
});

describe("connector migration", () => {
  it("keeps missing connectors absent during v1 to v2 migration", () => {
    const result = migrateConfigV1toV2(
      GatewayConfigSchema.parse({
        agents: [
          {
            id: "main",
            name: "Main",
            workspace: "~/agents/main",
            model: { provider: "anthropic", model: "claude" },
          },
        ],
        scheduler: {
          enabled: true,
          tickSeconds: 60,
        },
      })
    );

    expect(result.config.version).toBe(2);
    expect(result.config.connectors).toBeUndefined();
  });
});
