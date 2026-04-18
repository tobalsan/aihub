import { GatewayConfigSchema, type ExtensionContext } from "@aihub/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startSlackBots = vi.fn();
const stopSlackBots = vi.fn();

vi.mock("../../slack/index.js", () => ({
  startSlackBots,
  stopSlackBots,
}));

describe("slack component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a routed Slack bot", async () => {
    const { slackExtension } = await import("./index.js");
    const config = GatewayConfigSchema.parse({
      version: 2,
      agents: [
        {
          id: "main",
          name: "Main",
          workspace: "~/main",
          model: { provider: "anthropic", model: "claude" },
        },
      ],
      extensions: {
        slack: {
          enabled: true,
          token: "xoxb-test",
          appToken: "xapp-test",
          channels: {
            C1: { agent: "main", requireMention: false },
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

    await slackExtension.start(ctx);

    expect(startSlackBots).toHaveBeenCalledWith({
      agents: config.agents,
      componentConfig: expect.objectContaining({
        token: "xoxb-test",
        appToken: "xapp-test",
        channels: { C1: { agent: "main", requireMention: false } },
      }),
    });
  });

  it("stops Slack bots", async () => {
    const { slackExtension } = await import("./index.js");
    await slackExtension.stop();
    expect(stopSlackBots).toHaveBeenCalledOnce();
  });
});
