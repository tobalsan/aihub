import { describe, expect, it, vi, beforeEach } from "vitest";
import { GatewayConfigSchema, type ComponentContext } from "@aihub/shared";

const startDiscordBots = vi.fn();
const stopDiscordBots = vi.fn();

vi.mock("../../discord/index.js", () => ({
  startDiscordBots,
  stopDiscordBots,
}));

describe("discord component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves component token and starts a single routed bot", async () => {
    process.env.DISCORD_TOKEN = "env-token";

    const { discordComponent } = await import("./index.js");
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
          token: "$env:DISCORD_TOKEN",
          channels: {
            "123": { agent: "main", requireMention: false },
          },
          dm: { enabled: true, agent: "main" },
        },
      },
    });

    const ctx = {
      resolveSecret: vi.fn(),
      getAgent: (id: string) => config.agents.find((agent) => agent.id === id),
      getAgents: () => config.agents,
      runAgent: vi.fn(),
      getConfig: () => config,
    } satisfies ComponentContext;

    await discordComponent.start(ctx);

    expect(startDiscordBots).toHaveBeenCalledWith({
      agents: config.agents,
      componentConfig: expect.objectContaining({
        token: "env-token",
        channels: {
          "123": { agent: "main", requireMention: false },
        },
        dm: { enabled: true, agent: "main" },
      }),
    });
    expect(ctx.resolveSecret).not.toHaveBeenCalled();

    delete process.env.DISCORD_TOKEN;
  });

  it("uses component context secret resolver for vault refs", async () => {
    const { discordComponent } = await import("./index.js");
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
          token: "$secret:discord_bot_token",
          channels: {
            "123": { agent: "main" },
          },
        },
      },
    });

    const ctx = {
      resolveSecret: vi.fn().mockResolvedValue("secret-token"),
      getAgent: (id: string) => config.agents.find((agent) => agent.id === id),
      getAgents: () => config.agents,
      runAgent: vi.fn(),
      getConfig: () => config,
    } satisfies ComponentContext;

    await discordComponent.start(ctx);

    expect(ctx.resolveSecret).toHaveBeenCalledWith("discord_bot_token");
    expect(startDiscordBots).toHaveBeenCalledWith({
      agents: config.agents,
      componentConfig: expect.objectContaining({
        token: "secret-token",
      }),
    });
  });

  it("stops discord bots", async () => {
    const { discordComponent } = await import("./index.js");

    await discordComponent.stop();

    expect(stopDiscordBots).toHaveBeenCalledOnce();
  });
});
