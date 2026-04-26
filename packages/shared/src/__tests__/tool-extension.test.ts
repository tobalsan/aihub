import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineToolExtension } from "../tool-extension.js";
import { GatewayConfigSchema } from "../types.js";

describe("tool extensions", () => {
  it("merges root and agent config, resolves env refs, and prefixes tools", async () => {
    process.env.AIHUB_TEST_TOKEN = "secret";
    let receivedConfig: unknown;
    const extension = defineToolExtension({
      id: "sample",
      displayName: "Sample",
      description: "Sample tool extension",
      systemPrompt: "Use Sample when needed.",
      configSchema: z.object({
        token: z.string(),
        region: z.string(),
      }),
      agentConfigSchema: z.object({
        region: z.string(),
      }),
      requiredSecrets: ["token"],
      createTools(config) {
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

    const config = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          extensions: {
            sample: { enabled: true, region: "eu" },
          },
        },
      ],
      extensions: {
        sample: { token: "$env:AIHUB_TEST_TOKEN", region: "us" },
      },
    });

    const agent = config.agents[0]!;
    const tools = await extension.getAgentTools?.(agent, { config });
    const prompt = await extension.getSystemPromptContributions?.(agent, {
      config,
    });

    expect(receivedConfig).toEqual({
      global: { token: "secret", region: "us" },
      root: { token: "secret", region: "us" },
      agent: { region: "eu" },
      merged: { token: "secret", region: "eu" },
    });
    expect(tools?.[0]?.name).toBe("sample_ping");
    expect(tools?.[0]?.parameters).toMatchObject({ type: "object" });
    expect(prompt).toEqual([
      "Use Sample when needed.",
      [
        "AIHub exposes this extension's tools with these exact names:",
        "- sample_ping: Ping",
      ].join("\n"),
    ]);

    delete process.env.AIHUB_TEST_TOKEN;
  });

  it("does not enable tools from root config alone", async () => {
    const extension = defineToolExtension({
      id: "sample",
      displayName: "Sample",
      description: "Sample tool extension",
      configSchema: z.object({}),
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
      extensions: { sample: {} },
    });

    expect(extension.getAgentTools?.(config.agents[0]!, { config })).toEqual(
      []
    );
  });

  it("validates required secrets per enabled agent", () => {
    const extension = defineToolExtension({
      id: "sample",
      displayName: "Sample",
      description: "Sample tool extension",
      configSchema: z.object({ apiKey: z.string().optional() }),
      requiredSecrets: ["apiKey"],
      createTools: () => [],
    });
    const config = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          extensions: { sample: {} },
        },
      ],
      extensions: { sample: {} },
    });

    expect(extension.validateAgentConfigs?.(config)).toEqual({
      valid: false,
      errors: [
        'Extension "sample" for agent "main" config invalid: Extension "sample" for agent "main" missing required secret "apiKey"',
      ],
    });
  });
});
