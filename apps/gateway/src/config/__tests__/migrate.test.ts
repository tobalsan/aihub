import { describe, expect, it } from "vitest";
import { GatewayConfigSchema } from "@aihub/shared";
import { migrateConfigV1toV2 } from "../migrate.js";

describe("migrateConfigV1toV2", () => {
  it("moves legacy config into components", () => {
    const { config, warnings } = migrateConfigV1toV2(
      GatewayConfigSchema.parse({
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          discord: {
            token: "$env:DISCORD_TOKEN",
            channelId: "123",
            dm: { enabled: true, groupEnabled: false },
          },
          heartbeat: { every: "30m" },
          amsg: { enabled: true },
        },
      ],
      scheduler: { enabled: true, tickSeconds: 60 },
      projects: { root: "~/projects" },
      })
    );

    expect(warnings).toEqual([]);
    expect(config.version).toBe(2);
    expect(config.components?.discord?.channels?.["123"]?.agent).toBe("main");
    expect(config.components?.heartbeat?.enabled).toBe(true);
    expect(config.components?.amsg?.enabled).toBe(true);
    expect(config.components?.scheduler?.tickSeconds).toBe(60);
    expect(config.components?.projects?.root).toBe("~/projects");
    expect(config.components?.conversations?.enabled).toBe(true);
    expect(config.agents[0]?.discord?.token).toBe("$env:DISCORD_TOKEN");
  });

  it("warns when multiple discord tokens exist", () => {
    const { warnings } = migrateConfigV1toV2(
      GatewayConfigSchema.parse({
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/agents/main",
          model: { provider: "anthropic", model: "claude" },
          discord: { token: "token-a", channelId: "123" },
        },
        {
          id: "ops",
          name: "Ops",
          workspace: "~/agents/ops",
          model: { provider: "anthropic", model: "claude" },
          discord: { token: "token-b", channelId: "456" },
        },
      ],
      })
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Multiple Discord tokens found");
  });
});
