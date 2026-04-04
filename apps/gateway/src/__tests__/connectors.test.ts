import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AgentConfigSchema,
  GatewayConfigSchema,
  clearConnectors,
  registerConnector,
} from "@aihub/shared";
import {
  getConnectorPromptsForAgent,
  getConnectorToolsForAgent,
  initializeConnectors,
} from "../connectors/index.js";

describe("gateway connectors", () => {
  const prevAihubHome = process.env.AIHUB_HOME;

  beforeEach(() => {
    clearConnectors();
  });

  afterEach(() => {
    clearConnectors();
    if (prevAihubHome === undefined) {
      delete process.env.AIHUB_HOME;
    } else {
      process.env.AIHUB_HOME = prevAihubHome;
    }
  });

  it("loads enabled connector tools for an agent", async () => {
    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({
        apiKey: z.string(),
        region: z.string(),
      }),
      agentConfigSchema: z.object({
        region: z.string().optional(),
      }),
      requiredSecrets: ["apiKey"],
      createTools: (config) => [
        {
          name: "ping",
          description: `Ping ${String(config.merged.region)}`,
          parameters: z.object({
            companyId: z.string(),
          }),
          execute: async () => ({ ok: true }),
        },
      ],
    });

    const gatewayConfig = GatewayConfigSchema.parse({
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
              region: "eu",
            },
          },
        },
      ],
      connectors: {
        sample: {
          apiKey: "secret",
          region: "us",
        },
      },
    });
    const agentConfig = AgentConfigSchema.parse(gatewayConfig.agents[0]);

    const tools = getConnectorToolsForAgent(agentConfig, gatewayConfig);

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("sample.ping");
    expect(tools[0]?.description).toBe("Ping eu");
  });

  it("skips disabled connectors for an agent", () => {
    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({ apiKey: z.string() }),
      requiredSecrets: ["apiKey"],
      createTools: () => [
        {
          name: "ping",
          description: "Ping",
          parameters: z.object({}),
          execute: async () => ({ ok: true }),
        },
      ],
    });

    const gatewayConfig = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          connectors: {
            sample: {
              enabled: false,
            },
          },
        },
      ],
      connectors: {
        sample: {
          apiKey: "secret",
        },
      },
    });
    const agentConfig = AgentConfigSchema.parse(gatewayConfig.agents[0]);

    expect(getConnectorToolsForAgent(agentConfig, gatewayConfig)).toEqual([]);
  });

  it("warns and does not crash when configured connectors are missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

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

      await expect(initializeConnectors(config)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        '[connectors] agent "main" references unknown connector "missing"'
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("discovers external connectors from AIHUB_HOME by default", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "aihub-home-"));
    const connectorDir = path.join(homeDir, "connectors", "cloudifi-admin");
    const zodUrl = pathToFileURL(require.resolve("zod")).href;

    try {
      process.env.AIHUB_HOME = homeDir;
      await mkdir(connectorDir, { recursive: true });
      await writeFile(
        path.join(connectorDir, "package.json"),
        JSON.stringify({ type: "module" })
      );
      await writeFile(
        path.join(connectorDir, "index.js"),
        [
          `import { z } from ${JSON.stringify(zodUrl)};`,
          "export default {",
          '  id: "cloudifi-admin",',
          '  displayName: "Cloudifi Admin",',
          '  description: "Cloudifi admin connector",',
          '  systemPrompt: "Use Cloudifi Admin for account tasks.",',
          "  configSchema: z.object({}),",
          "  requiredSecrets: [],",
          "  createTools: () => [],",
          "};",
        ].join("\n")
      );

      const gatewayConfig = GatewayConfigSchema.parse({
        version: 2,
        agents: [
          {
            id: "main",
            name: "Main",
            workspace: "~/agents/main",
            model: { provider: "anthropic", model: "claude" },
            connectors: {
              "cloudifi-admin": {},
            },
          },
        ],
      });
      const agentConfig = AgentConfigSchema.parse(gatewayConfig.agents[0]);

      await initializeConnectors(gatewayConfig);

      expect(getConnectorToolsForAgent(agentConfig, gatewayConfig)).toEqual([]);
      expect(getConnectorPromptsForAgent(agentConfig, gatewayConfig)).toEqual([
        {
          id: "cloudifi-admin",
          prompt: "Use Cloudifi Admin for account tasks.",
        },
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
