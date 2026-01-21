/**
 * Integration tests for Discord bot message/reaction handling.
 *
 * Tests the actual handleMessage and handleReaction flows from bot.ts
 * with a mock Carbon client and mocked runAgent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentConfig, DiscordConfig } from "@aihub/shared";

// Mock runAgent and agentEventBus before importing bot
vi.mock("../agents/index.js", () => {
  const EventEmitter = require("node:events");
  const mockEventBus = new EventEmitter();
  return {
    runAgent: vi.fn(),
    agentEventBus: {
      onStreamEvent: vi.fn((handler: (event: unknown) => void) => {
        mockEventBus.on("stream", handler);
        return () => mockEventBus.off("stream", handler);
      }),
      emitStreamEvent: vi.fn((event: unknown) => {
        mockEventBus.emit("stream", event);
      }),
      _emitter: mockEventBus,
    },
  };
});

// Mock heartbeat module
const heartbeatEventEmitter = new (require("node:events").EventEmitter)();
vi.mock("../heartbeat/index.js", () => ({
  onHeartbeatEvent: vi.fn((handler: (event: unknown) => void) => {
    heartbeatEventEmitter.on("heartbeat", handler);
    return () => heartbeatEventEmitter.off("heartbeat", handler);
  }),
}));

// Mock session utils
vi.mock("../sessions/index.js", () => ({
  getSessionEntry: vi.fn(() => ({ sessionId: "test-session", updatedAt: Date.now() })),
  DEFAULT_MAIN_KEY: "main",
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
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ id: "app-123" }),
  } as Response)
);

// Mock the Carbon client creation
vi.mock("./client.js", () => {
  return {
    createCarbonClient: vi.fn(),
    getGatewayPlugin: vi.fn(() => ({ disconnect: vi.fn() })),
  };
});

import { createDiscordBot } from "./bot.js";
import { runAgent, agentEventBus } from "../agents/index.js";
import { createCarbonClient } from "./client.js";
import { startTyping, stopAllTyping } from "./utils/typing.js";
import { getThreadStarter } from "./utils/threads.js";
import { recordMessage, getHistory, clearHistory } from "./utils/history.js";

// Type helpers
const mockRunAgent = runAgent as ReturnType<typeof vi.fn>;
const mockCreateCarbonClient = createCarbonClient as ReturnType<typeof vi.fn>;

// Helper to capture handlers passed to createCarbonClient
type CapturedHandlers = {
  onMessage?: (data: unknown, client: unknown) => Promise<void>;
  onReaction?: (data: unknown, client: unknown, added: boolean) => Promise<void>;
  onReady?: (data: unknown, client: unknown) => void;
};

function createMockClient() {
  return {
    rest: {
      post: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve({})),
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
      onReaction?: CapturedHandlers["onReaction"];
      onReady?: CapturedHandlers["onReady"];
    }) => {
      capturedHandlers.onMessage = config.onMessage;
      capturedHandlers.onReaction = config.onReaction;
      capturedHandlers.onReady = config.onReady;
      return mockClient;
    });

    // Default runAgent mock
    mockRunAgent.mockResolvedValue({
      payloads: [{ text: "Hello from agent" }],
      meta: { durationMs: 100, sessionId: "test-session" },
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

      // Return queued result
      mockRunAgent.mockResolvedValue({
        payloads: [],
        meta: {
          durationMs: 0,
          sessionId: "test-session",
          queued: true,
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

      await cmd.run(mockInteraction as any);

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

      await cmd.run(mockInteraction as any);

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

      await cmd.run(mockInteraction as any);

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
      onReaction?: CapturedHandlers["onReaction"];
      onReady?: CapturedHandlers["onReady"];
    }) => {
      capturedHandlers.onMessage = config.onMessage;
      capturedHandlers.onReaction = config.onReaction;
      capturedHandlers.onReady = config.onReady;
      return mockClient;
    });

    // Remove all heartbeat listeners before each test
    heartbeatEventEmitter.removeAllListeners();
  });

  afterEach(() => {
    vi.clearAllMocks();
    heartbeatEventEmitter.removeAllListeners();
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
    heartbeatEventEmitter.emit("heartbeat", {
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
    heartbeatEventEmitter.emit("heartbeat", {
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

    heartbeatEventEmitter.emit("heartbeat", {
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
    heartbeatEventEmitter.emit("heartbeat", {
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
    heartbeatEventEmitter.emit("heartbeat", {
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

    heartbeatEventEmitter.emit("heartbeat", {
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
    heartbeatEventEmitter.emit("heartbeat", {
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
    heartbeatEventEmitter.emit("heartbeat", {
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
