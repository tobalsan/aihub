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
          token: "env-token",
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
  });

  it("uses already resolved config values", async () => {
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
          token: "secret-token",
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

    expect(ctx.resolveSecret).not.toHaveBeenCalled();
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
