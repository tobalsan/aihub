/**
 * Integration tests for Discord bot message/reaction handling.
 *
 * Tests the actual handleMessage and handleReaction flows from bot.ts
 * with a mock Carbon client and mocked runAgent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Drain the microtask queue so async subscription callbacks complete before assertions.
const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));
import type {
  AgentConfig,
  DiscordComponentConfig,
  DiscordConfig,
  ExtensionContext,
} from "@aihub/shared";

const extensionEventEmitter = new EventEmitter();
const mockRunAgent = vi.fn();
const mockGetDataDir = vi.fn(() => "/tmp/aihub-discord-test");
const mockGetSessionEntry = vi.fn(() =>
  Promise.resolve({ sessionId: "test-session", updatedAt: Date.now() })
);
const mockSubscribe = vi.fn((event: string, handler: (payload: unknown) => void) => {
  extensionEventEmitter.on(event, handler);
  return () => extensionEventEmitter.off(event, handler);
});

const mockExtensionContext = {
  runAgent: mockRunAgent,
  getSessionEntry: mockGetSessionEntry,
  subscribe: mockSubscribe,
  getDataDir: mockGetDataDir,
} as unknown as ExtensionContext;

vi.mock("./context.js", () => ({
  getDiscordContext: vi.fn(() => mockExtensionContext),
}));

// Mock typing utils
vi.mock("./utils/typing.js", () => ({
  startTyping: vi.fn(),
  stopTyping: vi.fn(),
  stopAllTyping: vi.fn(),
}));

// Mock history utils
vi.mock("./utils/history.js", () => ({
  recordMessage: vi.fn(),
  getHistory: vi.fn(() => []),
  clearHistory: vi.fn(),
}));

// Mock channel utils
vi.mock("./utils/channel.js", () => ({
  getChannelMetadata: vi.fn(() => Promise.resolve({ name: "general", topic: null })),
}));

// Mock thread utils
vi.mock("./utils/threads.js", () => ({
  getThreadStarter: vi.fn(() => Promise.resolve(null)),
}));

// Mock global fetch for Discord API (application ID lookup)
const mockFetch = Object.assign(
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: "app-123" }),
    } as Response)
  ),
  { preconnect: vi.fn() }
);
global.fetch = mockFetch as unknown as typeof fetch;

// Mock the Carbon client creation
vi.mock("./client.js", () => {
  return {
    createCarbonClient: vi.fn(),
    getGatewayPlugin: vi.fn(() => ({ disconnect: vi.fn() })),
  };
});

import { createDiscordBot, createDiscordComponentBot } from "./bot.js";
import { createCarbonClient } from "./client.js";
import { startTyping, stopAllTyping } from "./utils/typing.js";
import { getThreadStarter } from "./utils/threads.js";
import { recordMessage, clearHistory } from "./utils/history.js";
import { createThreadSessionBindingStore } from "./thread-session-bindings.js";

// Type helpers
const mockCreateCarbonClient = createCarbonClient as ReturnType<typeof vi.fn>;

// Helper to capture handlers passed to createCarbonClient
type CapturedHandlers = {
  onMessage?: (data: unknown, client: unknown) => Promise<void>;
  onThreadCreate?: (data: unknown, client: unknown) => Promise<void>;
  onReaction?: (data: unknown, client: unknown, added: boolean) => Promise<void>;
  onReady?: (data: unknown, client: unknown) => void;
};

function createMockClient() {
  return {
    rest: {
      post: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve({})),
      put: vi.fn(() => Promise.resolve()),
    },
    handleDeployRequest: vi.fn(() => Promise.resolve()),
  };
}

function createTestAgent(discordOverrides: Partial<DiscordConfig> = {}): AgentConfig {
  return {
    id: "test-agent",
    name: "Test Agent",
    workspace: "~/test",
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    },
    queueMode: "queue",
    discord: {
      token: "test-token",
      groupPolicy: "open",
      historyLimit: 20,
      clearHistoryAfterReply: true,
      replyToMode: "off",
      ...discordOverrides,
    },
  };
}

function createTestComponentConfig(
  overrides: Partial<DiscordComponentConfig> = {}
): DiscordComponentConfig {
  return {
    token: "test-token",
    channels: {
      "channel-1": {
        agent: "test-agent",
        requireMention: false,
      },
    },
    historyLimit: 20,
    clearHistoryAfterReply: true,
    replyToMode: "off",
    ...overrides,
  };
}

describe("Discord bot integration", () => {
  let capturedHandlers: CapturedHandlers;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandlers = {};
    mockClient = createMockClient();

    // Capture handlers when createCarbonClient is called
    mockCreateCarbonClient.mockImplementation((config: {
      onMessage?: CapturedHandlers["onMessage"];
      onThreadCreate?: CapturedHandlers["onThreadCreate"];
      onReaction?: CapturedHandlers["onReaction"];
      onReady?: CapturedHandlers["onReady"];
    }) => {
      capturedHandlers.onMessage = config.onMessage;
      capturedHandlers.onThreadCreate = config.onThreadCreate;
      capturedHandlers.onReaction = config.onReaction;
      capturedHandlers.onReady = config.onReady;
      return mockClient;
    });

    // Default runAgent mock — calls onEvent directly so the per-invocation
    // callback in handleDiscordMessage fires in tests (no global bus needed).
    mockRunAgent.mockImplementation((params: { agentId: string; sessionKey?: string; onEvent?: (event: unknown) => void }) => {
      params.onEvent?.({ type: "text", data: "Hello from agent" });
      params.onEvent?.({ type: "done", meta: { durationMs: 100 } });
      return Promise.resolve({
        payloads: [{ text: "Hello from agent" }],
        meta: { durationMs: 100, sessionId: "test-session" },
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("message handling", () => {
    describe("guild messages with requireMention", () => {
      it("ignores message without mention when requireMention=true (default)", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "off" },
          },
        });

        await createDiscordBot(agent);

        // Simulate ready to set botUserId
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        // Send message without mention
        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Hello without mention",
            channel_id: "channel-1",
            guild_id: "guild-1",
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [],
          },
          mockClient
        );

        // runAgent should NOT be called
        expect(mockRunAgent).not.toHaveBeenCalled();
        expect(startTyping).not.toHaveBeenCalled();
      });

      it("triggers run when message contains bot mention", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "off" },
          },
        });

        await createDiscordBot(agent);

        // Simulate ready
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        // Send message with mention
        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "<@bot-123> Hello bot!",
            channel_id: "channel-1",
            guild_id: "guild-1",
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [{ id: "bot-123" }],
          },
          mockClient
        );

        // runAgent should be called
        expect(mockRunAgent).toHaveBeenCalledTimes(1);
        expect(mockRunAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: "test-agent",
            message: "Hello bot!",
            source: "discord",
          })
        );

        // Typing indicator should start
        expect(startTyping).toHaveBeenCalled();

        // Response should be sent
        expect(mockClient.rest.post).toHaveBeenCalledWith(
          "/channels/channel-1/messages",
          expect.objectContaining({
            body: expect.objectContaining({ content: "Hello from agent" }),
          })
        );
      });

      it("starts and stops typing during run", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: false, reactionNotifications: "off" },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Hello",
            channel_id: "channel-1",
            guild_id: "guild-1",
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [],
          },
          mockClient
        );

        // Typing should start immediately
        expect(startTyping).toHaveBeenCalledWith(
          mockClient,
          "channel-1",
          "test-agent",
          expect.objectContaining({ sessionKey: "discord:channel-1" }),
          false
        );
      });
    });

    describe("thread messages with context", () => {
      it("includes thread starter in context when available", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: false, reactionNotifications: "off" },
          },
        });

        // Mock thread starter
        vi.mocked(getThreadStarter).mockResolvedValue({
          author: "original-author",
          content: "This is the thread starter message",
          timestamp: 1700000000000,
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Reply in thread",
            channel_id: "thread-channel-1",
            guild_id: "guild-1",
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [],
          },
          mockClient
        );

        // runAgent should be called with context containing thread_starter
        expect(mockRunAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              kind: "discord",
              blocks: expect.arrayContaining([
                expect.objectContaining({
                  type: "thread_starter",
                  author: "original-author",
                  content: "This is the thread starter message",
                }),
              ]),
            }),
          })
        );
      });
    });

    describe("DM handling", () => {
      it("ignores DM when dm.enabled=false", async () => {
        const agent = createTestAgent({
          dm: { enabled: false, groupEnabled: false },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        // DM message (no guild_id)
        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Hello in DM",
            channel_id: "dm-channel-1",
            guild_id: undefined,
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [],
          },
          mockClient
        );

        expect(mockRunAgent).not.toHaveBeenCalled();
      });

      it("allows DM when dm.enabled=true (default)", async () => {
        const agent = createTestAgent({
          dm: { enabled: true, groupEnabled: false },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Hello in DM",
            channel_id: "dm-channel-1",
            guild_id: undefined,
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [],
          },
          mockClient
        );

        expect(mockRunAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Hello in DM",
            sessionKey: "main", // DMs use main session
          })
        );
      });
    });

    describe("message history", () => {
      it("records non-bot messages in history", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "off" },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        // Message without mention (won't trigger reply but should record)
        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Regular chat message",
            channel_id: "channel-1",
            guild_id: "guild-1",
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [],
          },
          mockClient
        );

        expect(recordMessage).toHaveBeenCalledWith(
          "channel-1",
          expect.objectContaining({
            author: "testuser",
            content: "Regular chat message",
          }),
          20, // default historyLimit
          "msg-1"
        );
      });

      it("clears history after reply when clearHistoryAfterReply=true (default)", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: false, reactionNotifications: "off" },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Hello",
            channel_id: "channel-1",
            guild_id: "guild-1",
            author: { id: "user-1", username: "testuser", bot: false },
            mentions: [],
          },
          mockClient
        );
        // clearHistory is called after `await sendDiscordReply()` inside the
        // async subscription callback, so we need to drain the microtask queue.
        await flushPromises();

        expect(clearHistory).toHaveBeenCalledWith("channel-1");
      });
    });

    describe("bot message filtering", () => {
      it("ignores messages from bots", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: false, reactionNotifications: "off" },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onMessage?.(
          {
            id: "msg-1",
            content: "Bot message",
            channel_id: "channel-1",
            guild_id: "guild-1",
            author: { id: "other-bot", username: "OtherBot", bot: true },
            mentions: [],
          },
          mockClient
        );

        expect(mockRunAgent).not.toHaveBeenCalled();
        // Bot messages should not be recorded either
        expect(recordMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe("reaction handling", () => {
    describe("reactionNotifications modes", () => {
      it("ignores reactions when mode=off (default)", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "off" },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onReaction?.(
          {
            emoji: { name: "thumbsup" },
            user_id: "user-1",
            channel_id: "channel-1",
            message_id: "msg-1",
            guild_id: "guild-1",
          },
          mockClient,
          true // added
        );

        expect(mockRunAgent).not.toHaveBeenCalled();
      });

      it("processes reactions when mode=all", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "all" },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onReaction?.(
          {
            emoji: { name: "thumbsup" },
            user_id: "user-1",
            channel_id: "channel-1",
            message_id: "msg-1",
            guild_id: "guild-1",
          },
          mockClient,
          true
        );

        expect(mockRunAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: "test-agent",
            message: expect.stringContaining("reacted with"),
            source: "discord",
            context: expect.objectContaining({
              kind: "discord",
              blocks: expect.arrayContaining([
                expect.objectContaining({ type: "reaction" }),
              ]),
            }),
          })
        );
      });

      it("only triggers for allowlisted users when mode=allowlist", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": {
              requireMention: true,
              reactionNotifications: "allowlist",
              reactionAllowlist: ["allowed-user"],
            },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        // Non-allowlisted user
        await capturedHandlers.onReaction?.(
          {
            emoji: { name: "thumbsup" },
            user_id: "random-user",
            channel_id: "channel-1",
            message_id: "msg-1",
            guild_id: "guild-1",
          },
          mockClient,
          true
        );

        expect(mockRunAgent).not.toHaveBeenCalled();

        // Allowlisted user
        await capturedHandlers.onReaction?.(
          {
            emoji: { name: "heart" },
            user_id: "allowed-user",
            channel_id: "channel-1",
            message_id: "msg-1",
            guild_id: "guild-1",
          },
          mockClient,
          true
        );

        expect(mockRunAgent).toHaveBeenCalledTimes(1);
      });

      it("ignores DM reactions", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "all" },
          },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        // DM reaction (no guild_id)
        await capturedHandlers.onReaction?.(
          {
            emoji: { name: "thumbsup" },
            user_id: "user-1",
            channel_id: "dm-channel",
            message_id: "msg-1",
            guild_id: undefined,
          },
          mockClient,
          true
        );

        expect(mockRunAgent).not.toHaveBeenCalled();
      });
    });

    describe("own message mode", () => {
      it("triggers for reactions on bot's own messages when mode=own", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "own" },
          },
        });

        // Mock message fetch to return bot as author
        mockClient.rest.get.mockResolvedValue({
          author: { id: "bot-123" },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onReaction?.(
          {
            emoji: { name: "thumbsup" },
            user_id: "user-1",
            channel_id: "channel-1",
            message_id: "msg-1",
            guild_id: "guild-1",
          },
          mockClient,
          true
        );

        // Should fetch message to check author
        expect(mockClient.rest.get).toHaveBeenCalledWith(
          "/channels/channel-1/messages/msg-1"
        );

        // Should trigger runAgent
        expect(mockRunAgent).toHaveBeenCalled();
      });

      it("ignores reactions on other users' messages when mode=own", async () => {
        const agent = createTestAgent({
          guilds: {
            "guild-1": { requireMention: true, reactionNotifications: "own" },
          },
        });

        // Mock message fetch to return different user as author
        mockClient.rest.get.mockResolvedValue({
          author: { id: "other-user" },
        });

        await createDiscordBot(agent);
        capturedHandlers.onReady?.(
          { user: { id: "bot-123", username: "TestBot" } },
          mockClient
        );

        await capturedHandlers.onReaction?.(
          {
            emoji: { name: "thumbsup" },
            user_id: "user-1",
            channel_id: "channel-1",
            message_id: "msg-1",
            guild_id: "guild-1",
          },
          mockClient,
          true
        );

        expect(mockRunAgent).not.toHaveBeenCalled();
      });
    });
  });

  describe("bot lifecycle", () => {
    it("returns null when no discord token", async () => {
      const agent: AgentConfig = {
        id: "test-agent",
        name: "Test Agent",
        workspace: "~/test",
        model: { provider: "anthropic", model: "test" },
        queueMode: "queue",
        // No discord config
      };

      const bot = await createDiscordBot(agent);
      expect(bot).toBeNull();
    });

    it("creates bot with valid config", async () => {
      const agent = createTestAgent();
      const bot = await createDiscordBot(agent);

      expect(bot).not.toBeNull();
      expect(bot?.agentId).toBe("test-agent");
    });

    it("stops typing on stop()", async () => {
      const agent = createTestAgent();
      const bot = await createDiscordBot(agent);

      await bot?.start();
      await bot?.stop();

      expect(stopAllTyping).toHaveBeenCalled();
    });
  });

  describe("queued runs", () => {
    it("updates typing to queued mode when run is queued", async () => {
      const agent = createTestAgent({
        guilds: {
          "guild-1": { requireMention: false, reactionNotifications: "off" },
        },
      });

      // Return queued result — call onEvent with done+queued so the
      // per-invocation callback in handleDiscordMessage calls startTyping(queued=true).
      mockRunAgent.mockImplementation((params: { agentId: string; sessionKey?: string; onEvent?: (event: unknown) => void }) => {
        params.onEvent?.({ type: "done", meta: { durationMs: 0, queued: true } });
        return Promise.resolve({
          payloads: [],
          meta: { durationMs: 0, sessionId: "test-session", queued: true },
        });
      });

      await createDiscordBot(agent);
      capturedHandlers.onReady?.(
        { user: { id: "bot-123", username: "TestBot" } },
        mockClient
      );

      await capturedHandlers.onMessage?.(
        {
          id: "msg-1",
          content: "Hello",
          channel_id: "channel-1",
          guild_id: "guild-1",
          author: { id: "user-1", username: "testuser", bot: false },
          mentions: [],
        },
        mockClient
      );

      // Second call to startTyping with queued=true
      expect(startTyping).toHaveBeenCalledTimes(2);
      expect(startTyping).toHaveBeenLastCalledWith(
        mockClient,
        "channel-1",
        "test-agent",
        expect.objectContaining({ sessionKey: "discord:channel-1" }),
        true // queued
      );
    });
  });

  describe("ALG-205 regression: long-running agent", () => {
    it("onMessage returns before runAgent resolves, reply sent when done fires later", async () => {
      const agent = createTestAgent({
        guilds: {
          "guild-1": { requireMention: false, reactionNotifications: "off" },
        },
      });

      let capturedOnEvent: ((event: unknown) => void) | undefined;
      let resolveRunAgent!: (value: unknown) => void;
      const runAgentPromise = new Promise((resolve) => {
        resolveRunAgent = resolve;
      });

      mockRunAgent.mockImplementation((params: { onEvent?: (event: unknown) => void }) => {
        capturedOnEvent = params.onEvent;
        return runAgentPromise;
      });

      await createDiscordBot(agent);
      capturedHandlers.onReady?.(
        { user: { id: "bot-123", username: "TestBot" } },
        mockClient
      );

      // onMessage returns quickly — runAgent is fire-and-forget
      await capturedHandlers.onMessage?.(
        {
          id: "msg-1",
          content: "Complex long-running request",
          channel_id: "channel-1",
          guild_id: "guild-1",
          author: { id: "user-1", username: "testuser", bot: false },
          mentions: [],
        },
        mockClient
      );

      // Handler returned; runAgent was called but reply not sent yet
      expect(mockRunAgent).toHaveBeenCalledTimes(1);
      expect(mockClient.rest.post).not.toHaveBeenCalled();

      // Agent completes well after Carbon's 12 s timeout window
      capturedOnEvent?.({ type: "text", data: "Long response" });
      capturedOnEvent?.({ type: "done", meta: { durationMs: 30000 } });
      await flushPromises();

      expect(mockClient.rest.post).toHaveBeenCalledWith(
        "/channels/channel-1/messages",
        expect.objectContaining({
          body: expect.objectContaining({ content: "Long response" }),
        })
      );

      resolveRunAgent({ payloads: [], meta: { durationMs: 30000, sessionId: "test-session" } });
    });

    it("same-channel concurrent messages use isolated onEvent handlers (no cross-contamination)", async () => {
      const agent = createTestAgent({
        guilds: {
          "guild-1": { requireMention: false, reactionNotifications: "off" },
        },
      });

      const capturedOnEvents: Array<((event: unknown) => void) | undefined> = [];
      const resolvers: Array<(value: unknown) => void> = [];

      mockRunAgent.mockImplementation((params: { onEvent?: (event: unknown) => void }) => {
        capturedOnEvents.push(params.onEvent);
        const promise = new Promise((resolve) => resolvers.push(resolve));
        return promise;
      });

      await createDiscordBot(agent);
      capturedHandlers.onReady?.(
        { user: { id: "bot-123", username: "TestBot" } },
        mockClient
      );

      // Message A arrives — long run, not yet done
      await capturedHandlers.onMessage?.(
        {
          id: "msg-a",
          content: "Message A - long run",
          channel_id: "channel-1",
          guild_id: "guild-1",
          author: { id: "user-1", username: "testuser", bot: false },
          mentions: [],
        },
        mockClient
      );

      // Message B arrives in the same channel while A is still running
      await capturedHandlers.onMessage?.(
        {
          id: "msg-b",
          content: "Message B - quick",
          channel_id: "channel-1",
          guild_id: "guild-1",
          author: { id: "user-2", username: "testuser2", bot: false },
          mentions: [],
        },
        mockClient
      );

      expect(mockRunAgent).toHaveBeenCalledTimes(2);
      const [onEventA, onEventB] = capturedOnEvents;

      // B completes first — only B's reply should be sent
      onEventB?.({ type: "text", data: "Reply for B" });
      onEventB?.({ type: "done", meta: { durationMs: 100 } });
      await flushPromises();

      expect(mockClient.rest.post).toHaveBeenCalledTimes(1);
      expect(mockClient.rest.post).toHaveBeenCalledWith(
        "/channels/channel-1/messages",
        expect.objectContaining({
          body: expect.objectContaining({ content: "Reply for B" }),
        })
      );

      // A completes later — A's reply should now also be sent
      onEventA?.({ type: "text", data: "Reply for A" });
      onEventA?.({ type: "done", meta: { durationMs: 30000 } });
      await flushPromises();

      expect(mockClient.rest.post).toHaveBeenCalledTimes(2);
      expect(mockClient.rest.post).toHaveBeenLastCalledWith(
        "/channels/channel-1/messages",
        expect.objectContaining({
          body: expect.objectContaining({ content: "Reply for A" }),
        })
      );

      resolvers[0]?.({ payloads: [], meta: { durationMs: 30000, sessionId: "test-session" } });
      resolvers[1]?.({ payloads: [], meta: { durationMs: 100, sessionId: "test-session" } });
    });

    it("queued done from message B does not consume message A reply handler", async () => {
      // Regression for the queued-overlap path: when B hits done.meta.queued=true while
      // A is still running, B's onEvent must not set replyHandled on A's closure, and
      // A must still receive its own done event and send its reply.
      const agent = createTestAgent({
        guilds: {
          "guild-1": { requireMention: false, reactionNotifications: "off" },
        },
      });

      const capturedOnEvents: Array<((event: unknown) => void) | undefined> = [];
      const resolvers: Array<(value: unknown) => void> = [];

      mockRunAgent.mockImplementation((params: { onEvent?: (event: unknown) => void }) => {
        capturedOnEvents.push(params.onEvent);
        const promise = new Promise((resolve) => resolvers.push(resolve));
        return promise;
      });

      await createDiscordBot(agent);
      capturedHandlers.onReady?.(
        { user: { id: "bot-123", username: "TestBot" } },
        mockClient
      );

      // Message A: long-running, not yet done
      await capturedHandlers.onMessage?.(
        {
          id: "msg-a",
          content: "Message A - long run",
          channel_id: "channel-1",
          guild_id: "guild-1",
          author: { id: "user-1", username: "testuser", bot: false },
          mentions: [],
        },
        mockClient
      );

      // Message B: arrives in the same channel, hits the queue
      await capturedHandlers.onMessage?.(
        {
          id: "msg-b",
          content: "Message B - queued",
          channel_id: "channel-1",
          guild_id: "guild-1",
          author: { id: "user-2", username: "testuser2", bot: false },
          mentions: [],
        },
        mockClient
      );

      expect(mockRunAgent).toHaveBeenCalledTimes(2);
      const [onEventA, onEventB] = capturedOnEvents;

      // B fires done+queued — only typing should be updated, no Discord reply sent
      onEventB?.({ type: "done", meta: { durationMs: 0, queued: true } });
      await flushPromises();

      expect(mockClient.rest.post).not.toHaveBeenCalled();

      // A now completes — its reply must still be delivered
      onEventA?.({ type: "text", data: "Reply for A" });
      onEventA?.({ type: "done", meta: { durationMs: 30000 } });
      await flushPromises();

      expect(mockClient.rest.post).toHaveBeenCalledTimes(1);
      expect(mockClient.rest.post).toHaveBeenCalledWith(
        "/channels/channel-1/messages",
        expect.objectContaining({
          body: expect.objectContaining({ content: "Reply for A" }),
        })
      );

      resolvers[0]?.({ payloads: [], meta: { durationMs: 30000, sessionId: "test-session" } });
      resolvers[1]?.({ payloads: [], meta: { durationMs: 0, sessionId: "test-session" } });
    });
  });

  describe("error handling", () => {
    it("sends error message when runAgent throws", async () => {
      const agent = createTestAgent({
        guilds: {
          "guild-1": { requireMention: false, reactionNotifications: "off" },
        },
      });

      mockRunAgent.mockRejectedValue(new Error("Agent failed"));

      await createDiscordBot(agent);
      capturedHandlers.onReady?.(
        { user: { id: "bot-123", username: "TestBot" } },
        mockClient
      );

      await capturedHandlers.onMessage?.(
        {
          id: "msg-1",
          content: "Hello",
          channel_id: "channel-1",
          guild_id: "guild-1",
          author: { id: "user-1", username: "testuser", bot: false },
          mentions: [],
        },
        mockClient
      );

      // Error message should be sent
      expect(mockClient.rest.post).toHaveBeenCalledWith(
        "/channels/channel-1/messages",
        expect.objectContaining({
          body: expect.objectContaining({
            content: "Sorry, I encountered an error processing your message.",
          }),
        })
      );
    });
  });
});

/**
 * Slash command tests - /abort, /new
 *
 * Tests that slash commands correctly invoke runAgent with the expected params.
 */
describe("Discord slash commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AbortCommand", () => {
    it("calls runAgent with /abort message", async () => {
      // Import fresh to get clean mocks
      const { AbortCommand } = await import("./handlers/commands.js");

      const agent = createTestAgent();
      const cmd = new AbortCommand({ agent, botUserId: "bot-123" });

      const mockInteraction = {
        options: { raw: [] },
        rawData: { channel_id: "channel-1" },
        reply: vi.fn(),
      };

      // Mock runAgent for abort
      mockRunAgent.mockResolvedValue({
        payloads: [{ text: "Run aborted." }],
        meta: { durationMs: 0, sessionId: "test-session", aborted: true },
      });

      await cmd.run(
        mockInteraction as unknown as Parameters<typeof cmd.run>[0]
      );

      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "test-agent",
          message: "/abort",
          sessionKey: "main",
          source: "discord",
        })
      );

      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Run aborted." })
      );
    });

    it("uses custom session key when provided", async () => {
      const { AbortCommand } = await import("./handlers/commands.js");

      const agent = createTestAgent();
      const cmd = new AbortCommand({ agent, botUserId: "bot-123" });

      const mockInteraction = {
        options: { raw: [{ name: "session", value: "custom-session" }] },
        rawData: { channel_id: "channel-1", guild_id: "guild-1" },
        reply: vi.fn(),
      };

      mockRunAgent.mockResolvedValue({
        payloads: [{ text: "Run aborted." }],
        meta: { durationMs: 0, sessionId: "custom-session", aborted: true },
      });

      await cmd.run(
        mockInteraction as unknown as Parameters<typeof cmd.run>[0]
      );

      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey: "custom-session",
        })
      );
    });
  });

  describe("NewCommand", () => {
    it("calls runAgent with /new message to reset session", async () => {
      const { NewCommand } = await import("./handlers/commands.js");

      const agent = createTestAgent();
      const cmd = new NewCommand({ agent, botUserId: "bot-123" });

      const mockInteraction = {
        options: { raw: [] },
        rawData: { channel_id: "channel-1" },
        reply: vi.fn(),
      };

      mockRunAgent.mockResolvedValue({
        payloads: [{ text: "New conversation started." }],
        meta: { durationMs: 50, sessionId: "new-session" },
      });

      await cmd.run(
        mockInteraction as unknown as Parameters<typeof cmd.run>[0]
      );

      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "test-agent",
          message: "/new",
          sessionKey: "main",
          source: "discord",
        })
      );

      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "New conversation started." })
      );
    });
  });
});

/**
 * Heartbeat delivery tests
 *
 * Tests that heartbeat alerts are properly delivered to Discord when:
 * - The heartbeat event has status "sent"
 * - The bot is ready (botUserId set)
 * - The gateway is connected
 */
describe("Discord heartbeat delivery", () => {
  let capturedHandlers: CapturedHandlers;
  let mockClient: ReturnType<typeof createMockClient>;
  let mockGetGatewayPlugin: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedHandlers = {};
    mockClient = createMockClient();

    // Import fresh mock
    const { getGatewayPlugin } = await import("./client.js");
    mockGetGatewayPlugin = getGatewayPlugin as ReturnType<typeof vi.fn>;

    // Default: gateway is connected
    mockGetGatewayPlugin.mockReturnValue({ isConnected: true, disconnect: vi.fn() });

    // Capture handlers when createCarbonClient is called
    mockCreateCarbonClient.mockImplementation((config: {
      onMessage?: CapturedHandlers["onMessage"];
      onThreadCreate?: CapturedHandlers["onThreadCreate"];
      onReaction?: CapturedHandlers["onReaction"];
      onReady?: CapturedHandlers["onReady"];
    }) => {
      capturedHandlers.onMessage = config.onMessage;
      capturedHandlers.onThreadCreate = config.onThreadCreate;
      capturedHandlers.onReaction = config.onReaction;
      capturedHandlers.onReady = config.onReady;
      return mockClient;
    });

    // Remove all heartbeat listeners before each test
    extensionEventEmitter.removeAllListeners();
  });

  afterEach(() => {
    vi.clearAllMocks();
    extensionEventEmitter.removeAllListeners();
  });

  it("delivers heartbeat alert when bot is ready and gateway connected", async () => {
    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    // Simulate ready to set botUserId
    capturedHandlers.onReady?.(
      { user: { id: "bot-123", username: "TestBot" } },
      mockClient
    );

    // Emit heartbeat event with "sent" status
    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "test-agent",
      status: "sent",
      to: "broadcast-channel",
      alertText: "This is an important alert!",
      preview: "This is an important",
    });

    // Allow async handler to run
    await new Promise((r) => setTimeout(r, 10));

    // Should send message to Discord
    expect(mockClient.rest.post).toHaveBeenCalledWith(
      "/channels/broadcast-channel/messages",
      expect.objectContaining({
        body: { content: "This is an important alert!" },
      })
    );
  });

  it("skips delivery when bot is not ready (botUserId not set)", async () => {
    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    // Do NOT call onReady - botUserId stays undefined

    // Emit heartbeat event
    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "test-agent",
      status: "sent",
      to: "broadcast-channel",
      alertText: "This should not be delivered",
    });

    await new Promise((r) => setTimeout(r, 10));

    // Should NOT send message
    expect(mockClient.rest.post).not.toHaveBeenCalled();
  });

  it("skips delivery when gateway is not connected", async () => {
    // Gateway not connected
    mockGetGatewayPlugin.mockReturnValue({ isConnected: false, disconnect: vi.fn() });

    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    capturedHandlers.onReady?.(
      { user: { id: "bot-123", username: "TestBot" } },
      mockClient
    );

    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "test-agent",
      status: "sent",
      to: "broadcast-channel",
      alertText: "This should not be delivered",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockClient.rest.post).not.toHaveBeenCalled();
  });

  it("ignores heartbeat events for other agents", async () => {
    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    capturedHandlers.onReady?.(
      { user: { id: "bot-123", username: "TestBot" } },
      mockClient
    );

    // Emit heartbeat for different agent
    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "other-agent",
      status: "sent",
      to: "some-channel",
      alertText: "Should be ignored",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockClient.rest.post).not.toHaveBeenCalled();
  });

  it("ignores heartbeat events with non-sent status", async () => {
    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    capturedHandlers.onReady?.(
      { user: { id: "bot-123", username: "TestBot" } },
      mockClient
    );

    // Emit with "ok-token" status (should not deliver)
    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "test-agent",
      status: "ok-token",
      to: "broadcast-channel",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockClient.rest.post).not.toHaveBeenCalled();
  });

  it("splits long messages into 2000 char chunks", async () => {
    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    capturedHandlers.onReady?.(
      { user: { id: "bot-123", username: "TestBot" } },
      mockClient
    );

    // Create message longer than 2000 chars
    const longText = "A".repeat(2500);

    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "test-agent",
      status: "sent",
      to: "broadcast-channel",
      alertText: longText,
    });

    await new Promise((r) => setTimeout(r, 10));

    // Should send multiple messages
    expect(mockClient.rest.post).toHaveBeenCalledTimes(2);

    // First chunk should be 2000 chars
    expect(mockClient.rest.post).toHaveBeenNthCalledWith(
      1,
      "/channels/broadcast-channel/messages",
      expect.objectContaining({
        body: { content: "A".repeat(2000) },
      })
    );

    // Second chunk should be remaining 500 chars
    expect(mockClient.rest.post).toHaveBeenNthCalledWith(
      2,
      "/channels/broadcast-channel/messages",
      expect.objectContaining({
        body: { content: "A".repeat(500) },
      })
    );
  });

  it("unsubscribes from heartbeat events on stop()", async () => {
    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    capturedHandlers.onReady?.(
      { user: { id: "bot-123", username: "TestBot" } },
      mockClient
    );

    // Stop the bot
    await bot?.stop();

    // Emit heartbeat event after stop
    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "test-agent",
      status: "sent",
      to: "broadcast-channel",
      alertText: "Should not be delivered after stop",
    });

    await new Promise((r) => setTimeout(r, 10));

    // Should NOT send message (unsubscribed)
    expect(mockClient.rest.post).not.toHaveBeenCalled();
  });

  it("handles Discord API errors gracefully", async () => {
    const agent = createTestAgent({ broadcastToChannel: "broadcast-channel" });

    const bot = await createDiscordBot(agent);
    await bot?.start();

    capturedHandlers.onReady?.(
      { user: { id: "bot-123", username: "TestBot" } },
      mockClient
    );

    // Make Discord API throw error
    mockClient.rest.post.mockRejectedValueOnce(new Error("Discord API error"));

    // Should not throw
    extensionEventEmitter.emit("heartbeat.event", {
      ts: Date.now(),
      agentId: "test-agent",
      status: "sent",
      to: "broadcast-channel",
      alertText: "This will fail to send",
    });

    await new Promise((r) => setTimeout(r, 10));

    // Should have tried to send
    expect(mockClient.rest.post).toHaveBeenCalled();

    // Should not throw (no unhandled promise rejection)
  });
});

describe("Discord component bot", () => {
  let capturedHandlers: CapturedHandlers;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandlers = {};
    mockClient = createMockClient();

    mockCreateCarbonClient.mockImplementation((config: {
      onMessage?: CapturedHandlers["onMessage"];
      onThreadCreate?: CapturedHandlers["onThreadCreate"];
      onReaction?: CapturedHandlers["onReaction"];
      onReady?: CapturedHandlers["onReady"];
    }) => {
      capturedHandlers.onMessage = config.onMessage;
      capturedHandlers.onThreadCreate = config.onThreadCreate;
      capturedHandlers.onReaction = config.onReaction;
      capturedHandlers.onReady = config.onReady;
      return mockClient;
    });

    mockRunAgent.mockImplementation((params: { agentId: string; sessionKey?: string; onEvent?: (event: unknown) => void }) => {
      params.onEvent?.({ type: "text", data: "Hello from routed agent" });
      params.onEvent?.({ type: "done", meta: { durationMs: 100 } });
      return Promise.resolve({
        payloads: [{ text: "Hello from routed agent" }],
        meta: { durationMs: 100, sessionId: "test-session" },
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes configured channel messages through the shared component bot", async () => {
    const agent = createTestAgent();
    const componentConfig = createTestComponentConfig();

    await createDiscordComponentBot([agent], componentConfig);

    await capturedHandlers.onMessage?.(
      {
        id: "msg-1",
        content: "Hello routed channel",
        channel_id: "channel-1",
        guild_id: "guild-1",
        author: { id: "user-1", username: "testuser", bot: false },
        mentions: [],
      },
      mockClient
    );

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "test-agent",
        message: "Hello routed channel",
        sessionKey: "discord:channel-1",
        source: "discord",
      })
    );
  });

  it("routes configured DMs through the shared component bot main session", async () => {
    const agent = createTestAgent();
    const componentConfig = createTestComponentConfig({
      channels: {},
      dm: {
        enabled: true,
        agent: "test-agent",
      },
    });

    await createDiscordComponentBot([agent], componentConfig);

    await capturedHandlers.onMessage?.(
      {
        id: "msg-1",
        content: "Hello DM",
        channel_id: "dm-1",
        author: { id: "user-1", username: "testuser", bot: false },
        mentions: [],
      },
      mockClient
    );

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "test-agent",
        message: "Hello DM",
        sessionKey: "main",
        source: "discord",
      })
    );
  });

  it("spawns one bound session per subscribed agent when a forum thread is created", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-discord-forum-"));
    mockGetDataDir.mockReturnValue(dataDir);

    const alpha = createTestAgent({ forumChannels: ["forum-1"] });
    alpha.id = "alpha";
    const beta = createTestAgent({ forumChannels: ["forum-1"] });
    beta.id = "beta";
    const gamma = createTestAgent({ forumChannels: ["forum-2"] });
    gamma.id = "gamma";

    mockClient.rest.get.mockResolvedValueOnce([
      {
        id: "thread-1",
        content: "Forum starter",
        channel_id: "thread-1",
        guild_id: "guild-1",
        author: { id: "user-1", username: "testuser", bot: false },
        mentions: [],
      },
    ]);
    mockRunAgent.mockImplementation((params: { agentId: string; onEvent?: (event: unknown) => void }) => {
      params.onEvent?.({ type: "text", data: `Reply from ${params.agentId}` });
      params.onEvent?.({ type: "done", meta: { durationMs: 100 } });
      return Promise.resolve({
        payloads: [{ text: `Reply from ${params.agentId}` }],
        meta: { durationMs: 100, sessionId: `session-${params.agentId}` },
      });
    });

    try {
      await createDiscordComponentBot([alpha, beta, gamma], {
        token: "test-token",
      });

      await capturedHandlers.onThreadCreate?.(
        {
          id: "thread-1",
          guild_id: "guild-1",
          parent_id: "forum-1",
          newly_created: true,
          join: vi.fn(() => Promise.resolve()),
        },
        mockClient
      );
      await flushPromises();
      await flushPromises();

      expect(mockRunAgent).toHaveBeenCalledTimes(2);
      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "alpha",
          message: "Forum starter",
          sessionKey: "discord:forum:thread-1:alpha",
          source: "discord",
        })
      );
      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "beta",
          message: "Forum starter",
          sessionKey: "discord:forum:thread-1:beta",
          source: "discord",
        })
      );
      expect(mockClient.rest.post).toHaveBeenCalledWith(
        "/channels/thread-1/messages",
        expect.objectContaining({ body: { content: "Reply from alpha" } })
      );
      expect(mockClient.rest.post).toHaveBeenCalledWith(
        "/channels/thread-1/messages",
        expect.objectContaining({ body: { content: "Reply from beta" } })
      );

      const store = createThreadSessionBindingStore(dataDir);
      try {
        expect(store.getBindings("thread-1")).toMatchObject([
          {
            threadId: "thread-1",
            sessionId: "session-alpha",
            agentId: "alpha",
            channelId: "forum-1",
          },
          {
            threadId: "thread-1",
            sessionId: "session-beta",
            agentId: "beta",
            channelId: "forum-1",
          },
        ]);
      } finally {
        store.close();
      }
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not spawn sessions when Discord reports an existing forum thread", async () => {
    const alpha = createTestAgent({ forumChannels: ["forum-1"] });
    alpha.id = "alpha";

    await createDiscordComponentBot([alpha], {
      token: "test-token",
    });

    await capturedHandlers.onThreadCreate?.(
      {
        id: "thread-1",
        guild_id: "guild-1",
        parent_id: "forum-1",
        newly_created: false,
      },
      mockClient
    );

    expect(mockClient.rest.get).not.toHaveBeenCalled();
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it("does not spawn sessions when Discord omits newly_created on a forum thread", async () => {
    const alpha = createTestAgent({ forumChannels: ["forum-1"] });
    alpha.id = "alpha";

    await createDiscordComponentBot([alpha], {
      token: "test-token",
    });

    await capturedHandlers.onThreadCreate?.(
      {
        id: "thread-1",
        guild_id: "guild-1",
        parent_id: "forum-1",
      },
      mockClient
    );

    expect(mockClient.rest.get).not.toHaveBeenCalled();
    expect(mockRunAgent).not.toHaveBeenCalled();
  });
});
