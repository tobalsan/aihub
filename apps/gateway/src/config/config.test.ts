import { describe, it, expect } from "vitest";
import { GatewayConfigSchema } from "@aihub/shared";

describe("config validation", () => {
  it("validates a minimal config", () => {
    const config = {
      agents: [
        {
          id: "test-agent",
          name: "Test Agent",
          workspaceDir: "~/test",
          model: {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
          },
        },
      ],
    };

    const result = GatewayConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("validates config with all fields", () => {
    const config = {
      agents: [
        {
          id: "test-agent",
          name: "Test Agent",
          workspaceDir: "~/test",
          model: {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
          },
          thinkLevel: "medium",
          queueMode: "queue",
          discord: {
            token: "test-token",
            guildId: "123",
            channelId: "456",
          },
          amsg: {
            id: "test",
            enabled: true,
          },
        },
      ],
      server: {
        host: "0.0.0.0",
        port: 4000,
      },
      scheduler: {
        enabled: true,
        tickSeconds: 60,
      },
    };

    const result = GatewayConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects config without agents", () => {
    const config = {};
    const result = GatewayConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("rejects invalid thinkLevel", () => {
    const config = {
      agents: [
        {
          id: "test",
          name: "Test",
          workspaceDir: "~/test",
          model: { provider: "anthropic", model: "test" },
          thinkLevel: "invalid",
        },
      ],
    };

    const result = GatewayConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
