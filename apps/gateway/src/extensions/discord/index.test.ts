import { describe, expect, it, vi, beforeEach } from "vitest";
import { GatewayConfigSchema, type ExtensionContext } from "@aihub/shared";

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
    const { discordExtension } = await import("./index.js");
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
      extensions: {
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
      getConfig: () => config,
      getDataDir: () => "/tmp",
      getAgent: (id: string) => config.agents.find((agent) => agent.id === id),
      getAgents: () => config.agents,
      isAgentActive: () => true,
      isAgentStreaming: () => false,
      resolveWorkspaceDir: () => "/tmp",
      runAgent: vi.fn(),
      getSubagentTemplates: () => [],
      resolveSessionId: async () => undefined,
      getSessionEntry: async () => undefined,
      clearSessionEntry: async () => undefined,
      restoreSessionUpdatedAt: () => undefined,
      deleteSession: () => undefined,
      invalidateHistoryCache: async () => undefined,
      getSessionHistory: async () => [],
      subscribe: () => () => undefined,
      emit: () => undefined,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    } satisfies ExtensionContext;

    await discordExtension.start(ctx);

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
  });

  it("uses already resolved config values", async () => {
    const { discordExtension } = await import("./index.js");
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
      extensions: {
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
      getConfig: () => config,
      getDataDir: () => "/tmp",
      getAgent: (id: string) => config.agents.find((agent) => agent.id === id),
      getAgents: () => config.agents,
      isAgentActive: () => true,
      isAgentStreaming: () => false,
      resolveWorkspaceDir: () => "/tmp",
      runAgent: vi.fn(),
      getSubagentTemplates: () => [],
      resolveSessionId: async () => undefined,
      getSessionEntry: async () => undefined,
      clearSessionEntry: async () => undefined,
      restoreSessionUpdatedAt: () => undefined,
      deleteSession: () => undefined,
      invalidateHistoryCache: async () => undefined,
      getSessionHistory: async () => [],
      subscribe: () => () => undefined,
      emit: () => undefined,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    } satisfies ExtensionContext;

    await discordExtension.start(ctx);

    expect(startDiscordBots).toHaveBeenCalledWith({
      agents: config.agents,
      componentConfig: expect.objectContaining({
        token: "secret-token",
      }),
    });
  });

  it("stops discord bots", async () => {
    const { discordExtension } = await import("./index.js");

    await discordExtension.stop();

    expect(stopDiscordBots).toHaveBeenCalledOnce();
  });
});
