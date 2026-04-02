import { describe, expect, it } from "vitest";
import { GatewayConfigSchema } from "../types.js";

describe("GatewayConfigSchema v2", () => {
  it("parses v1 config without version", () => {
    const result = GatewayConfigSchema.parse({
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      scheduler: { enabled: true, tickSeconds: 60 },
    });

    expect(result.version).toBeUndefined();
    expect(result.scheduler?.enabled).toBe(true);
  });

  it("parses v2 config with secrets and components", () => {
    const result = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      secrets: {
        provider: "onecli",
        gatewayUrl: "http://localhost:10255",
      },
      components: {
        scheduler: { enabled: true, tickSeconds: 30 },
        heartbeat: { enabled: true },
      },
    });

    expect(result.version).toBe(2);
    expect(result.secrets?.provider).toBe("onecli");
    expect(result.components?.scheduler?.tickSeconds).toBe(30);
  });
});
