import { Client, GatewayIntentBits, Events, type Message } from "discord.js";
import type { AgentConfig } from "@aihub/shared";
import { runAgent } from "../agents/index.js";

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

    // Use channel ID as session ID for Discord
    const sessionId = `discord:${message.channelId}`;

    try {
      // Send typing indicator (only for text-based channels)
      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping();
      }

      const result = await runAgent({
        agentId: agent.id,
        message: content,
        sessionId,
        thinkLevel: agent.thinkLevel,
      });

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

  return {
    client,
    agentId: agent.id,
    start: async () => {
      await client.login(agent.discord!.token);
    },
    stop: async () => {
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
