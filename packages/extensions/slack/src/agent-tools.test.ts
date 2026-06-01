import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, GatewayConfig } from "@aihub/shared";
import { clearSlackClientCache, slackAgentTools } from "./agent-tools.js";
import { clearActiveBots, registerActiveBot } from "./bot-registry.js";
import type { SlackBot } from "./bot.js";
import type { SlackWebClient } from "./types.js";

function agent(id: string, slack?: AgentConfig["slack"]): AgentConfig {
  return {
    id,
    name: id,
    workspace: `/tmp/${id}`,
    workspaceDir: `/tmp/${id}`,
    model: { provider: "test", model: "test" },
    queueMode: "queue",
    slack,
  };
}

function config(extensionsSlack?: unknown): GatewayConfig {
  return {
    version: 3,
    agents: [],
    extensions: extensionsSlack
      ? { slack: extensionsSlack as never }
      : undefined,
    sessions: { idleMinutes: 360 },
    agentFab: false,
  } as unknown as GatewayConfig;
}

function registerMockBot(agentId: string, client: Partial<SlackWebClient>): void {
  registerActiveBot(agentId, {
    agentId,
    app: { client },
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as SlackBot);
}

function tool(name: string) {
  const found = slackAgentTools().find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

describe("slack agent tools", () => {
  afterEach(() => {
    clearActiveBots();
    clearSlackClientCache();
    vi.clearAllMocks();
  });

  it("exposes send_message, list_channels, and list_users", () => {
    expect(slackAgentTools().map((t) => t.name)).toEqual([
      "slack.send_message",
      "slack.list_channels",
      "slack.list_users",
    ]);
  });

  it("send_message posts to a channel via the active bot client", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "1.2" });
    registerMockBot("alpha", { chat: { postMessage } as never });

    const result = await tool("slack.send_message").execute(
      { channel: "C123", text: "hello **world**" },
      { agent: agent("alpha"), config: config() }
    );

    expect(result).toEqual({ ok: true, channel: "C123", ts: "1.2" });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      channel: "C123",
      mrkdwn: true,
      unfurl_links: false,
    });
  });

  it("send_message passes threadTs and targets a user ID for DMs", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "9.9" });
    registerMockBot("alpha", { chat: { postMessage } as never });

    await tool("slack.send_message").execute(
      { channel: "U999", text: "hi", threadTs: "1.0" },
      { agent: agent("alpha"), config: config() }
    );

    expect(postMessage.mock.calls[0][0]).toMatchObject({
      channel: "U999",
      thread_ts: "1.0",
    });
  });

  it("send_message errors when no token is configured and no bot is active", async () => {
    const result = await tool("slack.send_message").execute(
      { channel: "C1", text: "x" },
      { agent: agent("alpha"), config: config() }
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("list_channels filters by query and returns ids + names", async () => {
    const list = vi.fn().mockResolvedValue({
      channels: [
        { id: "C1", name: "general" },
        { id: "C2", name: "random" },
        { id: "C3", name: "general-news" },
      ],
      response_metadata: { next_cursor: "" },
    });
    registerMockBot("alpha", { conversations: { list } as never });

    const result = (await tool("slack.list_channels").execute(
      { query: "general" },
      { agent: agent("alpha"), config: config() }
    )) as { ok: boolean; channels: Array<{ id: string; name: string }> };

    expect(result.ok).toBe(true);
    expect(result.channels).toEqual([
      { id: "C1", name: "general" },
      { id: "C3", name: "general-news" },
    ]);
  });

  it("list_users skips bots/deleted and resolves display names", async () => {
    const list = vi.fn().mockResolvedValue({
      members: [
        { id: "U1", name: "alice", profile: { display_name: "Alice" } },
        { id: "U2", name: "bot", is_bot: true },
        { id: "U3", name: "gone", deleted: true },
        { id: "U4", name: "bob", profile: { real_name: "Bob R" } },
      ],
      response_metadata: { next_cursor: "" },
    });
    registerMockBot("alpha", { users: { list } as never });

    const result = (await tool("slack.list_users").execute(
      {},
      { agent: agent("alpha"), config: config() }
    )) as { ok: boolean; users: Array<{ id: string; name: string }> };

    expect(result.ok).toBe(true);
    expect(result.users).toEqual([
      { id: "U1", name: "Alice" },
      { id: "U4", name: "Bob R" },
    ]);
  });

  it("falls back to component bot client when agent-specific bot is absent", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: "3.3" });
    registerMockBot("slack", { chat: { postMessage } as never });

    const result = await tool("slack.send_message").execute(
      { channel: "C5", text: "hey" },
      { agent: agent("alpha"), config: config() }
    );

    expect(result).toMatchObject({ ok: true, ts: "3.3" });
  });
});
