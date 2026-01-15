import type { AgentConfig } from "@aihub/shared";
import { runAgent, agentEventBus } from "../agents/index.js";
import { getSessionEntry, DEFAULT_MAIN_KEY } from "../sessions/index.js";
import { onHeartbeatEvent } from "../heartbeat/index.js";
import {
  createCarbonClient,
  getGatewayPlugin,
  type CarbonClient,
  type MessageHandler,
  type ReactionHandler,
  type ReadyHandler,
} from "./client.js";
import { processMessage, type MessageData } from "./handlers/message.js";
import { processReaction, formatEmoji, type ReactionData } from "./handlers/reactions.js";
import { createSlashCommands } from "./handlers/commands.js";
import { buildDiscordContext } from "./utils/context.js";
import { getChannelMetadata } from "./utils/channel.js";
import { getThreadStarter } from "./utils/threads.js";
import { recordMessage, getHistory, clearHistory } from "./utils/history.js";
import { splitMessage } from "./utils/chunk.js";
import { startTyping, stopAllTyping } from "./utils/typing.js";

export type DiscordBot = {
  client: CarbonClient;
  agentId: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export async function createDiscordBot(agent: AgentConfig): Promise<DiscordBot | null> {
  if (!agent.discord?.token) return null;

  // Track accumulated text per session for broadcasting
  const textAccumulators = new Map<string, string>();
  let unsubscribeBroadcast: (() => void) | null = null;
  let unsubscribeHeartbeat: (() => void) | null = null;
  let botUserId: string | undefined;

  // Get config values with defaults
  const historyLimit = agent.discord.historyLimit ?? 20;
  const clearHistoryAfterReply = agent.discord.clearHistoryAfterReply ?? true;
  const replyToMode = agent.discord.replyToMode ?? "off";

  // Message handler
  const handleMessage: MessageHandler = async (data, client) => {
    // Run through message pipeline
    const msgData: MessageData = {
      id: data.id,
      content: data.content ?? "",
      channel_id: data.channel_id,
      guild_id: data.guild_id,
      author: {
        id: data.author.id,
        username: data.author.username,
        discriminator: data.author.discriminator,
        bot: data.author.bot,
      },
      mentions: data.mentions,
    };

    const result = processMessage(msgData, agent.discord!, botUserId);

    // Record message in history (regardless of whether we reply)
    if (!data.author.bot) {
      recordMessage(
        data.channel_id,
        {
          author: data.author.username,
          content: data.content ?? "",
          timestamp: Date.now(),
        },
        historyLimit
      );
    }

    if (!result.shouldReply) {
      // Debug logging for non-trivial rejections
      if (result.reason && result.reason !== "author_is_bot") {
        console.debug(`[discord:${agent.id}] Ignored: ${result.reason}`);
      }
      return;
    }

    const content = result.normalizedContent;
    if (!content) return;

    // Determine session routing:
    // - DMs: use sessionKey="main" (shares with web UI)
    // - Configured main channel (legacy channelId): use sessionKey="main"
    // - Other guild channels: use per-channel sessionKey
    const isMainChannel = agent.discord?.channelId === data.channel_id;
    const useMainSession = result.isDm || isMainChannel;
    const sessionKey = useMainSession ? DEFAULT_MAIN_KEY : `discord:${data.channel_id}`;

    // Start typing indicator immediately
    startTyping(client, data.channel_id, agent.id, { sessionKey }, false);

    try {
      // Build context for the agent
      const [channelMeta, threadStarter] = await Promise.all([
        getChannelMetadata(client, data.channel_id),
        getThreadStarter(client, data.channel_id),
      ]);

      const recentHistory = getHistory(data.channel_id, historyLimit);

      const context = buildDiscordContext({
        channelName: channelMeta.name,
        channelTopic: channelMeta.topic,
        threadStarter: threadStarter ?? undefined,
        history: recentHistory.length > 0 ? recentHistory : undefined,
      });

      const agentResult = await runAgent({
        agentId: agent.id,
        message: content,
        sessionKey,
        thinkLevel: agent.thinkLevel,
        source: "discord",
        context,
      });

      // For queued runs, update typing with queued TTL
      if (agentResult.meta.queued) {
        startTyping(client, data.channel_id, agent.id, { sessionKey }, true);
        return;
      }

      // Helper to build message body with optional reply reference
      const buildBody = (chunk: string, isFirst: boolean) => {
        const body: { content: string; message_reference?: { message_id: string } } = {
          content: chunk,
        };
        if (replyToMode === "all" || (replyToMode === "first" && isFirst)) {
          body.message_reference = { message_id: data.id };
        }
        return body;
      };

      // Send response via REST API
      let isFirstChunk = true;
      for (const payload of agentResult.payloads) {
        if (payload.text) {
          const chunks = splitMessage(payload.text);
          for (const chunk of chunks) {
            await client.rest.post(`/channels/${data.channel_id}/messages`, {
              body: buildBody(chunk, isFirstChunk),
            });
            isFirstChunk = false;
          }
        }
      }

      // Clear history after successful reply if configured
      if (clearHistoryAfterReply) {
        clearHistory(data.channel_id);
      }
    } catch (err) {
      console.error(`[discord:${agent.id}] Error:`, err);
      const errorBody: { content: string; message_reference?: { message_id: string } } = {
        content: "Sorry, I encountered an error processing your message.",
      };
      if (replyToMode !== "off") {
        errorBody.message_reference = { message_id: data.id };
      }
      await client.rest.post(`/channels/${data.channel_id}/messages`, {
        body: errorBody,
      });
    }
  };

  // Reaction handler
  const handleReaction: ReactionHandler = async (data, client, added) => {
    // Build reaction data - fetch message for author info if needed for "own" mode
    const reactionData: ReactionData = {
      emoji: data.emoji,
      user_id: data.user_id,
      channel_id: data.channel_id,
      message_id: data.message_id,
      guild_id: data.guild_id,
    };

    // For "own" mode, we need to fetch the message to check author
    const guildConfig = data.guild_id ? agent.discord?.guilds?.[data.guild_id] : undefined;
    const mode = guildConfig?.reactionNotifications ?? "off";

    if (mode === "own" && botUserId) {
      try {
        const msg = await client.rest.get(`/channels/${data.channel_id}/messages/${data.message_id}`) as { author?: { id: string } };
        reactionData.message_author_id = msg?.author?.id;
      } catch {
        // If we can't fetch the message, skip
        return;
      }
    }

    const result = processReaction(reactionData, agent.discord!, botUserId);

    if (!result.shouldProcess) {
      if (result.reason && result.reason !== "reactions_off") {
        console.debug(`[discord:${agent.id}] Reaction ignored: ${result.reason}`);
      }
      return;
    }

    // Build context with reaction info
    const context = buildDiscordContext({
      reaction: {
        emoji: formatEmoji(data.emoji),
        user: data.user_id, // Just user ID - could fetch username if needed
        messageId: data.message_id,
        action: added ? "add" : "remove",
      },
    });

    const sessionKey = `discord:${data.channel_id}`;

    try {
      // Create a synthetic message describing the reaction
      const action = added ? "reacted with" : "removed reaction";
      const message = `[SYSTEM] User ${data.user_id} ${action} ${formatEmoji(data.emoji)} on message ${data.message_id}`;

      await runAgent({
        agentId: agent.id,
        message,
        sessionKey,
        thinkLevel: agent.thinkLevel,
        source: "discord",
        context,
      });
      // Note: We don't send a reply for reaction events - agent just processes them silently
    } catch (err) {
      console.error(`[discord:${agent.id}] Reaction error:`, err);
    }
  };

  // Create slash commands if applicationId is present
  const hasCommands = Boolean(agent.discord.applicationId);
  const commands = hasCommands
    ? createSlashCommands({ agent, botUserId })
    : undefined;

  // Ready handler
  const handleReady: ReadyHandler = async (data, client) => {
    botUserId = data.user.id;
    console.log(`[discord:${agent.id}] Bot ready as ${data.user.username} (${botUserId})`);

    // Deploy slash commands if applicationId is configured
    if (hasCommands) {
      try {
        await client.handleDeployRequest();
        console.log(`[discord:${agent.id}] Slash commands deployed`);
      } catch (err) {
        console.error(`[discord:${agent.id}] Failed to deploy commands:`, err);
      }
    }
  };

  // Fetch application ID if not provided
  let clientId = agent.discord.applicationId;
  if (!clientId) {
    try {
      const res = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
        headers: { Authorization: `Bot ${agent.discord.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        clientId = data.id;
      }
    } catch {
      // Ignore fetch errors
    }
  }
  if (!clientId) {
    console.error(`[discord:${agent.id}] Failed to get application ID. Set 'applicationId' in config.`);
    return null;
  }

  // Create client
  const client = createCarbonClient({
    token: agent.discord.token,
    clientId,
    commands,
    onMessage: handleMessage,
    onReaction: handleReaction,
    onReady: handleReady,
  });

  // Broadcast main-session responses to Discord channel (for non-discord sources)
  const setupBroadcaster = () => {
    // Use broadcastToChannel if set, otherwise fall back to legacy channelId
    const broadcastChannel = agent.discord?.broadcastToChannel ?? agent.discord?.channelId;
    if (!broadcastChannel) return;

    unsubscribeBroadcast = agentEventBus.onStreamEvent(async (event) => {
      // Only handle events for this agent
      if (event.agentId !== agent.id) return;

      // Skip if originated from Discord (avoid echo loop)
      if (event.source === "discord") return;

      // Only broadcast main session events
      const mainEntry = getSessionEntry(agent.id, DEFAULT_MAIN_KEY);
      if (!mainEntry || mainEntry.sessionId !== event.sessionId) return;

      const accKey = `${event.agentId}:${event.sessionId}`;

      if (event.type === "text") {
        // Accumulate text chunks
        const current = textAccumulators.get(accKey) ?? "";
        textAccumulators.set(accKey, current + event.data);
      } else if (event.type === "done") {
        // Send accumulated text to Discord
        const text = textAccumulators.get(accKey);
        textAccumulators.delete(accKey);

        if (text) {
          try {
            const chunks = splitMessage(text, 2000);
            for (const chunk of chunks) {
              await client.rest.post(`/channels/${broadcastChannel}/messages`, {
                body: { content: chunk },
              });
            }
          } catch (err) {
            console.error(`[discord:${agent.id}] Broadcast error:`, err);
          }
        }
      } else if (event.type === "error") {
        // Clean up on error
        textAccumulators.delete(accKey);
      }
    });

    // Subscribe to heartbeat events for delivery
    unsubscribeHeartbeat = onHeartbeatEvent(async (payload) => {
      // Only handle events for this agent with "sent" status
      if (payload.agentId !== agent.id) return;
      if (payload.status !== "sent") return;
      if (!payload.to || !payload.alertText) return;

      // Check bot readiness
      if (!botUserId) {
        console.warn(`[discord:${agent.id}] Heartbeat delivery skipped: bot not ready`);
        return;
      }

      const gateway = getGatewayPlugin(client);
      if (!gateway?.isConnected) {
        console.warn(`[discord:${agent.id}] Heartbeat delivery skipped: gateway not connected`);
        return;
      }

      // Deliver heartbeat alert to Discord
      try {
        const chunks = splitMessage(payload.alertText, 2000);
        for (const chunk of chunks) {
          await client.rest.post(`/channels/${payload.to}/messages`, {
            body: { content: chunk },
          });
        }
        console.log(`[discord:${agent.id}] Heartbeat alert delivered to ${payload.to}`);
      } catch (err) {
        console.error(`[discord:${agent.id}] Heartbeat delivery error:`, err);
      }
    });
  };

  return {
    client,
    agentId: agent.id,
    start: async () => {
      // The GatewayPlugin connects automatically when the client is created
      // Nothing additional needed for connection
      setupBroadcaster();
    },
    stop: async () => {
      unsubscribeBroadcast?.();
      unsubscribeBroadcast = null;
      unsubscribeHeartbeat?.();
      unsubscribeHeartbeat = null;
      textAccumulators.clear();
      stopAllTyping();
      // Disconnect gateway
      const gateway = getGatewayPlugin(client);
      if (gateway) {
        gateway.disconnect();
      }
    },
  };
}
