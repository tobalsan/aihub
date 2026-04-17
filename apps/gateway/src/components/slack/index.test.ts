import { GatewayConfigSchema, type ComponentContext } from "@aihub/shared";
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
    const { slackComponent } = await import("./index.js");
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
      components: {
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
      resolveSecret: vi.fn(),
      getAgent: (id: string) => config.agents.find((agent) => agent.id === id),
      getAgents: () => config.agents,
      runAgent: vi.fn(),
      getConfig: () => config,
    } satisfies ComponentContext;

    await slackComponent.start(ctx);

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
    const { slackComponent } = await import("./index.js");
    await slackComponent.stop();
    expect(stopSlackBots).toHaveBeenCalledOnce();
  });
});
