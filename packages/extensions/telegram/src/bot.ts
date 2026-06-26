import { Bot } from "grammy";
import type { Context } from "grammy";
import type {
  AgentConfig,
  FileAttachment,
  TelegramAgentConfig,
  TelegramComponentConfig,
} from "@aihub/shared";
import {
  handleTelegramMessage,
  type TelegramMessageData,
} from "./handlers/message.js";
import { getTelegramContext } from "./context.js";
import { isBotAddressed, toAddressableMessage } from "./utils/addressing.js";
import {
  MAX_UPLOAD_SIZE_BYTES,
  downloadTelegramFile,
  formatTelegramFileError,
  uploadTelegramFileToMedia,
  type TelegramMediaItem,
} from "./utils/attachments.js";

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

/**
 * Extract any inbound media from a message. Photos arrive as an array of sizes
 * (smallest to largest); we take the largest so the agent gets full detail.
 * Documents carry their own filename and MIME type.
 */
function extractMedia(ctx: Context): TelegramMediaItem[] {
  const message = ctx.message;
  if (!message) return [];
  const media: TelegramMediaItem[] = [];

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    media.push({
      fileId: largest.file_id,
      size: largest.file_size,
      kind: "photo",
    });
  }

  if (message.document) {
    media.push({
      fileId: message.document.file_id,
      filename: message.document.file_name,
      mimeType: message.document.mime_type,
      size: message.document.file_size,
      kind: "document",
    });
  }

  return media;
}

function toMessageData(ctx: Context): TelegramMessageData | null {
  const chat = ctx.chat;
  if (!chat) return null;
  const media = extractMedia(ctx);
  // The text part is the message text, or the caption when media is attached.
  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  if (typeof text !== "string") return null;
  if (!text && media.length === 0) return null;
  const isPrivate = chat.type === "private";
  // Private chats are always addressed; in groups, only when the bot is spoken
  // to (mention, reply to the bot, or a command), so it never hijacks the chat.
  const isAddressed =
    isPrivate ||
    (ctx.message
      ? isBotAddressed(toAddressableMessage(ctx.message), {
          id: ctx.me?.id,
          username: ctx.me?.username,
        })
      : false);
  return {
    chatId: chat.id,
    chatType: chat.type,
    text,
    userId: ctx.from?.id,
    senderName: resolveSenderName(ctx),
    isBot: ctx.from?.is_bot ?? false,
    media: media.length > 0 ? media : undefined,
    isAddressed,
  };
}

/**
 * Download inbound media and persist it as agent attachments. Oversized or
 * undownloadable items are skipped with a user-facing notice rather than
 * crashing the turn, so a bad upload never takes the bot down.
 */
async function collectAttachments(
  ctx: Context,
  media: TelegramMediaItem[],
  botToken: string,
  logPrefix: string
): Promise<FileAttachment[]> {
  const saveMediaFile = getTelegramContext().saveMediaFile;
  if (!saveMediaFile) {
    throw new Error("Media upload is not available in the Telegram context");
  }

  const getFilePath = async (fileId: string): Promise<string | undefined> => {
    const file = await ctx.api.getFile(fileId);
    return file.file_path;
  };

  const attachments: FileAttachment[] = [];
  for (const item of media) {
    if (item.size && item.size > MAX_UPLOAD_SIZE_BYTES) {
      await ctx.reply(
        formatTelegramFileError(item, "File exceeds the 20MB upload limit")
      );
      continue;
    }

    try {
      const downloaded = await downloadTelegramFile(
        item,
        botToken,
        getFilePath
      );
      attachments.push(
        await uploadTelegramFileToMedia(downloaded, saveMediaFile)
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Download failed";
      console.warn(`${logPrefix} ${formatTelegramFileError(item, reason)}`);
      await ctx.reply(formatTelegramFileError(item, reason));
    }
  }

  return attachments;
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

  const onMessage = async (ctx: Context) => {
    const data = toMessageData(ctx);
    if (!data) return;
    await handleTelegramMessage(
      data,
      { agent, logPrefix },
      async (text, options) => {
        const sent = await ctx.reply(text, {
          parse_mode: options?.parseMode,
          reply_parameters: options?.replyToMessageId
            ? { message_id: options.replyToMessageId }
            : undefined,
        });
        return sent.message_id;
      },
      {
        sendTyping: async () => {
          await ctx.replyWithChatAction("typing");
        },
        collectAttachments: (media) =>
          collectAttachments(ctx, media, token, logPrefix),
      }
    );
  };

  // Text DMs plus media DMs: photos (images) and documents (logs/files).
  bot.on("message:text", onMessage);
  bot.on("message:photo", onMessage);
  bot.on("message:document", onMessage);

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
