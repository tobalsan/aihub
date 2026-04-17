import type { AgentConfig, SlackComponentConfig } from "@aihub/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../agents/index.js";
import { clearAllHistory, getHistory } from "./utils/history.js";

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

type SlackMessageCallback = (args: {
  message: Record<string, unknown>;
  client: MockSlackApp["client"];
}) => Promise<void>;

type SlackCommandCallback = (args: {
  command: { channel_id: string; user_id: string; text?: string };
  ack: () => Promise<unknown>;
  respond: (message: unknown) => Promise<unknown>;
}) => Promise<void>;

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

const mockRunAgent = vi.mocked(runAgent);

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

function getMessageHandler(app: MockSlackApp): SlackMessageCallback {
  return app.message.mock.calls[0]?.[0] as SlackMessageCallback;
}

function getCommandHandler(
  app: MockSlackApp,
  name: "/new" | "/abort" | "/help" | "/ping"
): SlackCommandCallback {
  const call = app.command.mock.calls.find(
    ([commandName]) => commandName === name
  );
  return call?.[1] as SlackCommandCallback;
}

describe("createSlackBot", () => {
  beforeEach(() => {
    apps.length = 0;
    vi.clearAllMocks();
    clearAllHistory();
    mockRunAgent.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 1, sessionId: "session" },
    });
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

  it("records history only after messages pass gating", async () => {
    const { createSlackBot } = await import("./bot.js");
    const bot = createSlackBot([agent], {
      ...config,
      channels: { C1: { agent: "main" } },
    });
    await bot?.start();

    const messageHandler = getMessageHandler(apps[0]);
    await messageHandler({
      message: {
        ts: "1.1",
        text: "hello without mention",
        channel: "C1",
        user: "U1",
        channel_type: "channel",
      },
      client: apps[0].client,
    });

    expect(getHistory("C1", 10)).toEqual([]);
    expect(mockRunAgent).not.toHaveBeenCalled();

    await messageHandler({
      message: {
        ts: "2.2",
        text: "<@Ubot> hello",
        channel: "C1",
        user: "U1",
        channel_type: "channel",
      },
      client: apps[0].client,
    });

    expect(getHistory("C1", 10)).toEqual([
      expect.objectContaining({ author: "U1", content: "<@Ubot> hello" }),
    ]);
    expect(mockRunAgent).toHaveBeenCalledOnce();
  });

  it("blocks /new for users outside channel allowlist", async () => {
    const { createSlackBot } = await import("./bot.js");
    createSlackBot([agent], {
      ...config,
      channels: {
        C1: { agent: "main", requireMention: false, users: ["U1"] },
      },
    });

    const newHandler = getCommandHandler(apps[0], "/new");
    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);
    await newHandler({
      command: { channel_id: "C1", user_id: "U2", text: "" },
      ack,
      respond,
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      text: "No agent is configured for this Slack route.",
      response_type: "ephemeral",
    });
  });

  it("blocks /new for DM users outside allowFrom", async () => {
    const { createSlackBot } = await import("./bot.js");
    createSlackBot([agent], {
      ...config,
      dm: { enabled: true, agent: "main", allowFrom: ["U1"] },
    });

    const newHandler = getCommandHandler(apps[0], "/new");
    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);
    await newHandler({
      command: { channel_id: "D1", user_id: "U2", text: "" },
      ack,
      respond,
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      text: "No agent is configured for this Slack route.",
      response_type: "ephemeral",
    });
  });
});

describe("createSlackAgentBot", () => {
  beforeEach(() => {
    apps.length = 0;
    vi.clearAllMocks();
    clearAllHistory();
    mockRunAgent.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 1, sessionId: "session" },
    });
  });

  it("returns null when agent has no slack config", async () => {
    const { createSlackAgentBot } = await import("./bot.js");
    const localAgent = {
      id: "a1",
      name: "Agent",
      workspace: "~/ws",
      thinkLevel: "off",
    } as AgentConfig;

    expect(createSlackAgentBot(localAgent)).toBeNull();
  });

  it("returns null when token is missing", async () => {
    const { createSlackAgentBot } = await import("./bot.js");
    const localAgent = {
      id: "a1",
      name: "Agent",
      workspace: "~/ws",
      thinkLevel: "off",
      slack: { appToken: "xapp-test" },
    } as AgentConfig;

    expect(createSlackAgentBot(localAgent)).toBeNull();
  });

  it("returns null when appToken is missing", async () => {
    const { createSlackAgentBot } = await import("./bot.js");
    const localAgent = {
      id: "a1",
      name: "Agent",
      workspace: "~/ws",
      thinkLevel: "off",
      slack: { token: "xoxb-test" },
    } as AgentConfig;

    expect(createSlackAgentBot(localAgent)).toBeNull();
  });

  it("creates a bot with agent.id as agentId (not \"slack\")", async () => {
    const { createSlackAgentBot } = await import("./bot.js");
    const localAgent = {
      id: "a1",
      name: "Agent",
      workspace: "~/ws",
      thinkLevel: "off",
      slack: { token: "xoxb-test", appToken: "xapp-test" },
    } as AgentConfig;

    const bot = createSlackAgentBot(localAgent);

    expect(bot).not.toBeNull();
    expect(bot?.agentId).toBe("a1");
    expect(apps[0].config).toEqual({
      token: "xoxb-test",
      appToken: "xapp-test",
      socketMode: true,
    });
  });

  it("routes all channels to the agent when no channels config", async () => {
    const { createSlackAgentBot } = await import("./bot.js");
    const localAgent = {
      id: "a1",
      name: "Agent",
      workspace: "~/ws",
      thinkLevel: "off",
      slack: { token: "xoxb-test", appToken: "xapp-test" },
    } as AgentConfig;

    const bot = createSlackAgentBot(localAgent);
    await bot?.start();

    const messageHandler = getMessageHandler(apps[0]);
    await messageHandler({
      message: {
        ts: "1.1",
        text: "<@Ubot> hello from random channel",
        channel: "C999",
        user: "U1",
        channel_type: "channel",
      },
      client: apps[0].client,
    });

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "a1",
        sessionKey: "slack:C999",
        source: "slack",
      })
    );
  });

  it("creates a bot with channels config for per-agent filtering", async () => {
    const { createSlackAgentBot } = await import("./bot.js");
    const localAgent = {
      id: "a1",
      name: "Agent",
      workspace: "~/ws",
      thinkLevel: "off",
      slack: {
        token: "xoxb-test",
        appToken: "xapp-test",
        channels: {
          C1: { requireMention: false },
        },
      },
    } as AgentConfig;

    const bot = createSlackAgentBot(localAgent);
    await bot?.start();

    const messageHandler = getMessageHandler(apps[0]);
    await messageHandler({
      message: {
        ts: "1.1",
        text: "ignored",
        channel: "C2",
        user: "U1",
        channel_type: "channel",
      },
      client: apps[0].client,
    });

    expect(mockRunAgent).not.toHaveBeenCalled();

    await messageHandler({
      message: {
        ts: "2.2",
        text: "handled",
        channel: "C1",
        user: "U1",
        channel_type: "channel",
      },
      client: apps[0].client,
    });

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "a1",
        sessionKey: "slack:C1",
        source: "slack",
      })
    );
  });

  it("creates a bot with DM config", async () => {
    const { createSlackAgentBot } = await import("./bot.js");
    const localAgent = {
      id: "a1",
      name: "Agent",
      workspace: "~/ws",
      thinkLevel: "off",
      slack: {
        token: "xoxb-test",
        appToken: "xapp-test",
        dm: { enabled: true },
      },
    } as AgentConfig;

    const bot = createSlackAgentBot(localAgent);
    await bot?.start();

    const messageHandler = getMessageHandler(apps[0]);
    await messageHandler({
      message: {
        ts: "1.1",
        text: "hello dm",
        channel: "D1",
        user: "U1",
        channel_type: "im",
      },
      client: apps[0].client,
    });

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "a1",
        sessionKey: "main",
        source: "slack",
      })
    );
  });
});
