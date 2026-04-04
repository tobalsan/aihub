import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentConfigSchema,
  GatewayConfigSchema,
  clearConnectors,
  registerConnector,
} from "@aihub/shared";
import { getConnectorPromptsForAgent } from "./index.js";

describe("getConnectorPromptsForAgent", () => {
  beforeEach(() => {
    clearConnectors();
  });

  afterEach(() => {
    clearConnectors();
  });

  it("returns prompts only for enabled connectors with system prompts", () => {
    registerConnector({
      id: "with-prompt",
      displayName: "With Prompt",
      description: "Connector with prompt",
      systemPrompt: "Use this connector for account lookups.",
      configSchema: z.object({}),
      requiredSecrets: [],
      createTools: () => [],
    });
    registerConnector({
      id: "without-prompt",
      displayName: "Without Prompt",
      description: "Connector without prompt",
      configSchema: z.object({}),
      requiredSecrets: [],
      createTools: () => [],
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
            "with-prompt": { enabled: true },
            "without-prompt": { enabled: true },
          },
        },
      ],
    });
    const agentConfig = AgentConfigSchema.parse(gatewayConfig.agents[0]);

    expect(getConnectorPromptsForAgent(agentConfig, gatewayConfig)).toEqual([
      { id: "with-prompt", prompt: "Use this connector for account lookups." },
    ]);
  });

  it("returns an empty array when a connector has no system prompt", () => {
    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      configSchema: z.object({}),
      requiredSecrets: [],
      createTools: () => [],
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
            sample: { enabled: true },
          },
        },
      ],
    });
    const agentConfig = AgentConfigSchema.parse(gatewayConfig.agents[0]);

    expect(getConnectorPromptsForAgent(agentConfig, gatewayConfig)).toEqual([]);
  });

  it("returns an empty array when a connector is disabled", () => {
    registerConnector({
      id: "sample",
      displayName: "Sample",
      description: "Sample connector",
      systemPrompt: "Use this connector.",
      configSchema: z.object({}),
      requiredSecrets: [],
      createTools: () => [],
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
            sample: { enabled: false },
          },
        },
      ],
    });
    const agentConfig = AgentConfigSchema.parse(gatewayConfig.agents[0]);

    expect(getConnectorPromptsForAgent(agentConfig, gatewayConfig)).toEqual([]);
  });

  it("returns an empty array when no connectors are configured", () => {
    const gatewayConfig = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
    });
    const agentConfig = AgentConfigSchema.parse(gatewayConfig.agents[0]);

    expect(getConnectorPromptsForAgent(agentConfig, gatewayConfig)).toEqual([]);
  });
});
