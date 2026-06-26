import { Bot } from "grammy";
import type { Context } from "grammy";
import type {
  AgentConfig,
  TelegramAgentConfig,
  TelegramComponentConfig,
} from "@aihub/shared";
import {
  handleTelegramMessage,
  type TelegramMessageData,
} from "./handlers/message.js";

export type TelegramBot = {
  bot: Bot;
  agentId: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

function resolveSenderName(ctx: Context): string {
  const from = ctx.from;
  if (!from) return "unknown";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  return from.username || name.trim() || String(from.id);
}

function toMessageData(ctx: Context): TelegramMessageData | null {
  const chat = ctx.chat;
  const text = ctx.message?.text;
  if (!chat || typeof text !== "string") return null;
  return {
    chatId: chat.id,
    chatType: chat.type,
    text,
    userId: ctx.from?.id,
    senderName: resolveSenderName(ctx),
    isBot: ctx.from?.is_bot ?? false,
  };
}

/**
 * Create a long-polling grammY bot for an agent. The bot starts/stops through
 * the returned lifecycle handle. grammY's `bot.start()` resolves only when the
 * bot stops, so it is launched in the background and we await `bot.init()` to
 * surface connection errors during startup.
 */
function createBot(
  token: string,
  agent: AgentConfig,
  agentId: string = agent.id
): TelegramBot {
  const bot = new Bot(token);
  const logPrefix = `[telegram:${agentId}]`;

  bot.on("message:text", async (ctx) => {
    const data = toMessageData(ctx);
    if (!data) return;
    await handleTelegramMessage(
      data,
      { agent, logPrefix },
      async (text) => {
        await ctx.reply(text);
      },
      {
        sendTyping: async () => {
          await ctx.replyWithChatAction("typing");
        },
      }
    );
  });

  let running = false;

  return {
    bot,
    agentId,
    start: async () => {
      await bot.init();
      running = true;
      // bot.start() resolves only on stop; run it in the background.
      void bot.start({
        onStart: () => console.log(`${logPrefix} Started long-polling bot`),
      });
    },
    stop: async () => {
      if (!running) return;
      running = false;
      await bot.stop();
    },
  };
}

export function createTelegramBot(
  agents: AgentConfig[],
  componentConfig: TelegramComponentConfig
): TelegramBot | null {
  if (!componentConfig.token) return null;
  const agent = agents[0];
  if (!agent) return null;
  // Register the shared component bot under the literal "telegram" id (mirrors
  // the discord/slack house style), so proactive tools can resolve it via
  // getActiveBot("telegram").
  return createBot(componentConfig.token, agent, "telegram");
}

export function createTelegramAgentBot(agent: AgentConfig): TelegramBot | null {
  const config = agent.telegram as TelegramAgentConfig | undefined;
  if (!config?.token) return null;
  return createBot(config.token, agent);
}
