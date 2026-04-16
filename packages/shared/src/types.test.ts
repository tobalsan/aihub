import { describe, it, expect } from "vitest";
import {
  AgentConfigSchema,
  ContainerInputSchema,
  ContainerOutputSchema,
  GatewayConfigSchema,
} from "./types.js";

describe("AgentConfigSchema openclaw model handling", () => {
  it("allows openclaw agents to omit model", () => {
    const result = AgentConfigSchema.safeParse({
      id: "openclaw-agent",
      name: "OpenClaw Agent",
      workspace: "~/agents/openclaw",
      sdk: "openclaw",
    });

    expect(result.success).toBe(true);
  });

  it("requires model for non-openclaw SDKs", () => {
    const result = AgentConfigSchema.safeParse({
      id: "pi-agent",
      name: "Pi Agent",
      workspace: "~/agents/pi",
      sdk: "pi",
    });

    expect(result.success).toBe(false);
  });

  it("applies default model when openclaw model is omitted", () => {
    const result = AgentConfigSchema.parse({
      id: "openclaw-agent",
      name: "OpenClaw Agent",
      workspace: "~/agents/openclaw",
      sdk: "openclaw",
    });

    expect(result.model).toEqual({ provider: "openclaw", model: "unknown" });
  });

  it("accepts openclaw sessionMode dedicated", () => {
    const result = AgentConfigSchema.safeParse({
      id: "openclaw-agent",
      name: "OpenClaw Agent",
      workspace: "~/agents/openclaw",
      sdk: "openclaw",
      openclaw: {
        token: "token",
        sessionMode: "dedicated",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts description and avatar fields", () => {
    const result = AgentConfigSchema.safeParse({
      id: "test-agent",
      name: "Test Agent",
      description: "A helpful assistant",
      avatar: "🤖",
      workspace: "~/agents/test",
      model: { provider: "anthropic", model: "claude-sonnet-4" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("A helpful assistant");
      expect(result.data.avatar).toBe("🤖");
    }
  });

  it("accepts openclaw sessionMode fixed", () => {
    const result = AgentConfigSchema.safeParse({
      id: "openclaw-agent",
      name: "OpenClaw Agent",
      workspace: "~/agents/openclaw",
      sdk: "openclaw",
      openclaw: {
        token: "token",
        sessionMode: "fixed",
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("sandbox config schemas", () => {
  it("applies per-agent sandbox defaults", () => {
    const result = AgentConfigSchema.parse({
      id: "sandbox-agent",
      name: "Sandbox Agent",
      workspace: "~/agents/sandbox",
      model: { provider: "anthropic", model: "claude" },
      sandbox: {},
    });

    expect(result.sandbox).toMatchObject({
      enabled: false,
      image: "aihub-agent:latest",
      memory: "2g",
      cpus: 1,
      timeout: 300,
      workspaceWritable: false,
    });
  });

  it("applies global sandbox defaults", () => {
    const result = GatewayConfigSchema.parse({
      agents: [
        {
          id: "sandbox-agent",
          name: "Sandbox Agent",
          workspace: "~/agents/sandbox",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      sandbox: {
        network: {},
        mountAllowlist: {
          allowedRoots: ["~/agents"],
        },
      },
    });

    expect(result.sandbox?.network).toEqual({
      name: "aihub-agents",
      internal: true,
    });
    expect(result.sandbox?.mountAllowlist?.blockedPatterns).toEqual([
      ".ssh",
      ".gnupg",
      ".aws",
      ".env",
    ]);
  });
});

describe("container IPC schemas", () => {
  it("parses container input and output", () => {
    const input = ContainerInputSchema.parse({
      agentId: "sandbox-agent",
      sessionId: "session-1",
      message: "hello",
      workspaceDir: "/workspace",
      sessionDir: "/sessions",
      ipcDir: "/workspace/ipc",
      gatewayUrl: "http://gateway:3000",
      agentToken: "token",
      connectorConfigs: [
        {
          id: "github",
          systemPrompt: "Use GitHub tools when needed.",
          tools: [
            {
              name: "github.search",
              description: "Search repositories",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
              },
            },
          ],
        },
      ],
      sdkConfig: {
        sdk: "pi",
        model: { provider: "anthropic", model: "claude" },
      },
    });
    const output = ContainerOutputSchema.parse({ text: "hello back" });

    expect(input.workspaceDir).toBe("/workspace");
    expect(output.text).toBe("hello back");
  });
});
