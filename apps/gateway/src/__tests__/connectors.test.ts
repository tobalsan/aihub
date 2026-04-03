import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AgentConfigSchema,
  GatewayConfigSchema,
  clearConnectors,
  registerConnector,
} from "@aihub/shared";
import {
  getConnectorToolsForAgent,
  initializeConnectors,
} from "../connectors/index.js";

describe("gateway connectors", () => {
  beforeEach(() => {
    clearConnectors();
  });

  afterEach(() => {
    clearConnectors();
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
});
