import type { AgentConfig, SlackComponentConfig } from "@aihub/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockSlackApp = {
  config: Record<string, unknown>;
  client: {
    auth: { test: ReturnType<typeof vi.fn> };
    chat: { postMessage: ReturnType<typeof vi.fn> };
    conversations: {
      info: ReturnType<typeof vi.fn>;
      history: ReturnType<typeof vi.fn>;
    };
    reactions: {
      add: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
  };
  message: ReturnType<typeof vi.fn>;
  event: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

const apps: MockSlackApp[] = [];

vi.mock("@slack/bolt", () => ({
  App: vi.fn((config: Record<string, unknown>) => {
    const app: MockSlackApp = {
      config,
      client: {
        auth: { test: vi.fn().mockResolvedValue({ user_id: "Ubot" }) },
        chat: { postMessage: vi.fn().mockResolvedValue({}) },
        conversations: {
          info: vi.fn().mockResolvedValue({ channel: { name: "general" } }),
          history: vi.fn().mockResolvedValue({ messages: [] }),
        },
        reactions: {
          add: vi.fn().mockResolvedValue({}),
          remove: vi.fn().mockResolvedValue({}),
        },
      },
      message: vi.fn(),
      event: vi.fn(),
      command: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    apps.push(app);
    return app;
  }),
}));

vi.mock("../agents/index.js", () => ({
  runAgent: vi.fn(),
  agentEventBus: {
    onStreamEvent: vi.fn(() => () => undefined),
  },
}));

vi.mock("../sessions/index.js", () => ({
  DEFAULT_MAIN_KEY: "main",
  getSessionEntry: vi.fn(),
}));

const agent: AgentConfig = {
  id: "main",
  name: "Main",
  workspace: "~/main",
  model: { provider: "anthropic", model: "claude" },
  queueMode: "queue",
};

const config: SlackComponentConfig = {
  token: "xoxb-test",
  appToken: "xapp-test",
  channels: {
    C1: { agent: "main", requireMention: false },
  },
  dm: { enabled: true, agent: "main" },
};

describe("createSlackBot", () => {
  beforeEach(() => {
    apps.length = 0;
    vi.clearAllMocks();
  });

  it("creates a Bolt Socket Mode app and registers handlers", async () => {
    const { createSlackBot } = await import("./bot.js");
    const bot = createSlackBot([agent], config);

    expect(bot).not.toBeNull();
    expect(apps[0].config).toEqual({
      token: "xoxb-test",
      appToken: "xapp-test",
      socketMode: true,
    });
    expect(apps[0].message).toHaveBeenCalledOnce();
    expect(apps[0].event).toHaveBeenCalledWith(
      "app_mention",
      expect.any(Function)
    );
    expect(apps[0].event).toHaveBeenCalledWith(
      "reaction_added",
      expect.any(Function)
    );
    expect(apps[0].event).toHaveBeenCalledWith(
      "reaction_removed",
      expect.any(Function)
    );
    expect(apps[0].command).toHaveBeenCalledTimes(4);
  });

  it("starts and stops the Bolt app", async () => {
    const { createSlackBot } = await import("./bot.js");
    const bot = createSlackBot([agent], config);
    await bot?.start();
    await bot?.stop();

    expect(apps[0].client.auth.test).toHaveBeenCalledOnce();
    expect(apps[0].start).toHaveBeenCalledOnce();
    expect(apps[0].stop).toHaveBeenCalledOnce();
  });
});
