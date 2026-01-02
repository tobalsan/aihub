import { Client, GatewayIntentBits, Events, type Message, type TextChannel } from "discord.js";
import type { AgentConfig } from "@aihub/shared";
import { runAgent, agentEventBus, type AgentStreamEvent } from "../agents/index.js";
import { getSessionEntry, DEFAULT_MAIN_KEY } from "../sessions/index.js";

export type DiscordBot = {
  client: Client;
  agentId: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export function createDiscordBot(agent: AgentConfig): DiscordBot | null {
  if (!agent.discord?.token) return null;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  // Track accumulated text per session for broadcasting
  const textAccumulators = new Map<string, string>();
  let unsubscribeBroadcast: (() => void) | null = null;

  const handleMessage = async (message: Message) => {
    // Ignore bots
    if (message.author.bot) return;

    // Check if message is in the configured channel (if specified)
    if (agent.discord?.channelId && message.channelId !== agent.discord.channelId) {
      return;
    }

    // Check if in configured guild (if specified)
    if (agent.discord?.guildId && message.guildId !== agent.discord.guildId) {
      return;
    }

    const content = message.content.trim();
    if (!content) return;

    // If this is the configured main channel, route via sessionKey="main"
    // Otherwise, use per-channel sessionId
    const isMainChannel = agent.discord?.channelId === message.channelId;

    try {
      // Send typing indicator (only for text-based channels)
      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping();
      }

      const result = await runAgent({
        agentId: agent.id,
        message: content,
        ...(isMainChannel
          ? { sessionKey: DEFAULT_MAIN_KEY }
          : { sessionId: `discord:${message.channelId}` }),
        thinkLevel: agent.thinkLevel,
        source: "discord",
      });

      // Skip reply for queued messages - response will come when run completes
      if (result.meta.queued) return;

      // Send response
      for (const payload of result.payloads) {
        if (payload.text) {
          // Discord has a 2000 char limit
          const chunks = splitMessage(payload.text, 2000);
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        }
      }
    } catch (err) {
      console.error(`[discord:${agent.id}] Error:`, err);
      await message.reply("Sorry, I encountered an error processing your message.");
    }
  };

  client.on(Events.MessageCreate, handleMessage);

  client.on(Events.ClientReady, () => {
    console.log(`[discord:${agent.id}] Bot ready as ${client.user?.tag}`);
  });

  client.on(Events.Error, (err) => {
    console.error(`[discord:${agent.id}] Error:`, err);
  });

  // Broadcast main-session responses to Discord channel (for non-discord sources)
  const setupBroadcaster = () => {
    if (!agent.discord?.channelId) return;

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
            const channel = await client.channels.fetch(agent.discord!.channelId!);
            if (channel && "send" in channel) {
              const chunks = splitMessage(text, 2000);
              for (const chunk of chunks) {
                await (channel as TextChannel).send(chunk);
              }
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
  };

  return {
    client,
    agentId: agent.id,
    start: async () => {
      await client.login(agent.discord!.token);
      setupBroadcaster();
    },
    stop: async () => {
      unsubscribeBroadcast?.();
      unsubscribeBroadcast = null;
      textAccumulators.clear();
      await client.destroy();
    },
  };
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline or space
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
