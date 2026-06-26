import type { AgentConfig, ChannelConversationType, FileAttachment } from "@aihub/shared";
import { DEFAULT_MAIN_KEY, buildTelegramContext } from "@aihub/shared";
import { getTelegramContext } from "../context.js";
import {
  matchesChatAllowlist,
  matchesUserAllowlist,
  type AllowlistEntry,
} from "../utils/allowlist.js";
import { splitMessage } from "../utils/chunk.js";
import { renderMarkdown } from "../utils/render.js";
import { TypingKeepAlive, type SendTyping } from "../utils/typing.js";
import type { TelegramMediaItem } from "../utils/attachments.js";

export type TelegramMessageData = {
  chatId: number;
  chatType: string;
  /** Public group/channel username, when the chat exposes one. */
  chatUsername?: string;
  /** Message text, or the caption when the message carries media. */
  text: string;
  userId?: number;
  /** Sender's Telegram @username, when set. */
  username?: string;
  senderName: string;
  isBot: boolean;
  /** Inbound media (photos/documents) attached to the message. */
  media?: TelegramMediaItem[];
  /**
   * Whether the bot was addressed in a group chat: an @mention of the bot, a
   * reply to one of the bot's own messages, or a command. Always treated as
   * true for private chats by the bot layer. Drives the group-chat gate so the
   * bot joins the conversation only when spoken to, never hijacking every
   * message.
   */
  isAddressed?: boolean;
};

/**
 * Allowlist configuration for the bot, mirroring the discord/slack allow-list
 * shape. Both lists gate access independently: the sender must match
 * `allowedUsers` and the chat must match `allowedChats`.
 */
export type TelegramAllowlistConfig = {
  allowedUsers?: AllowlistEntry[];
  allowedChats?: AllowlistEntry[];
};

export type TelegramReplyTarget = {
  agent: AgentConfig;
  logPrefix: string;
};

export type TelegramSendOptions = {
  /** Render with this Telegram parse mode. */
  parseMode?: "HTML";
  /** Thread this message as a reply to the given message id. */
  replyToMessageId?: number;
};

/**
 * Send one rendered chunk. Returns the id of the message Telegram created so the
 * next chunk can thread as a reply to it (visual grouping for overflow).
 */
export type TelegramSend = (
  text: string,
  options?: TelegramSendOptions
) => Promise<number | undefined>;

export type TelegramHandlerHooks = {
  /** Best-effort sender for Telegram's "typing" chat action. */
  sendTyping?: SendTyping;
  /**
   * Download and persist inbound media, returning the resulting attachments to
   * hand to the agent. Invoked only when the message carries media. Implemented
   * by the bot layer, which owns the grammY context needed to fetch files.
   */
  collectAttachments?: (
    media: TelegramMediaItem[]
  ) => Promise<FileAttachment[]>;
};

export type TelegramPipelineResult = {
  shouldReply: boolean;
  reason?: string;
};

/** A private (1:1) chat is the only Telegram chat type treated as a DM. */
function isDirectMessage(chatType: string): boolean {
  return chatType === "private";
}

/**
 * Decide whether an inbound message should be handled.
 *
 * DMs (private chats) always run, matching the walking skeleton. Group chats
 * (`group`/`supergroup`) act as a shared group brain: the bot joins the
 * conversation only when addressed (an @mention, a reply to the bot, or a
 * command) so it contributes to the channel without hijacking every message.
 * The bot's own messages are ignored everywhere.
 *
 * Before any dispatch the user and chat allowlists are enforced: the sender
 * must be in `allowedUsers` and the chat in `allowedChats`. Both lists fail
 * closed — an empty/omitted list allows no one — matching the discord/slack
 * allowlist convention.
 */
export function processMessage(
  data: TelegramMessageData,
  allowlist: TelegramAllowlistConfig = {}
): TelegramPipelineResult {
  if (data.isBot) {
    return { shouldReply: false, reason: "author_is_bot" };
  }
  if (
    !matchesUserAllowlist(
      { id: data.userId, username: data.username },
      allowlist.allowedUsers
    )
  ) {
    return { shouldReply: false, reason: "user_not_allowed" };
  }
  if (
    !matchesChatAllowlist(
      { id: data.chatId, username: data.chatUsername },
      allowlist.allowedChats
    )
  ) {
    return { shouldReply: false, reason: "chat_not_allowed" };
  }
  // In a group, only respond when the bot is directly addressed.
  if (!isDirectMessage(data.chatType) && !data.isAddressed) {
    return { shouldReply: false, reason: "not_addressed" };
  }
  // Media-only messages are valid: the caption (if any) is the text part and
  // the attachments carry the content.
  if (!data.text.trim() && !(data.media && data.media.length > 0)) {
    return { shouldReply: false, reason: "empty_message" };
  }
  return { shouldReply: true };
}

export async function handleTelegramMessage(
  data: TelegramMessageData,
  target: TelegramReplyTarget,
  send: TelegramSend,
  hooks: TelegramHandlerHooks = {},
  allowlist: TelegramAllowlistConfig = {}
): Promise<void> {
  const result = processMessage(data, allowlist);
  if (!result.shouldReply) {
    if (result.reason && result.reason !== "author_is_bot") {
      console.debug(`${target.logPrefix} Ignored: ${result.reason}`);
    }
    return;
  }

  // DMs resolve to the agent's main session (matching discord/slack DM
  // handling), keeping each person's DM isolated. Group chats resolve to a
  // shared per-chat session key so the whole channel contributes to one
  // collective conversation — the shared group brain.
  const isDm = isDirectMessage(data.chatType);
  const sessionKey = isDm ? DEFAULT_MAIN_KEY : `telegram:${data.chatId}`;
  const conversationType: ChannelConversationType = isDm
    ? "direct_message"
    : "channel_message";
  const place = isDm
    ? `direct message / ${data.senderName}`
    : `group chat / ${data.chatId}`;
  const context = buildTelegramContext({
    metadata: {
      channel: "telegram",
      place,
      conversationType,
      sender: data.senderName,
    },
  });

  // Resolve any inbound media into agent attachments before starting the turn.
  let attachments: FileAttachment[] = [];
  if (data.media && data.media.length > 0 && hooks.collectAttachments) {
    try {
      attachments = await hooks.collectAttachments(data.media);
    } catch (err) {
      console.error(`${target.logPrefix} Attachment download failed:`, err);
      await send(
        "Sorry, I couldn't download the attached media. Please try again."
      );
      return;
    }
  }

  // A media-only message with no caption and no usable attachments has nothing
  // for the agent to act on.
  if (!data.text.trim() && attachments.length === 0) return;

  // Keep the typing indicator alive for the full turn. It starts as the turn
  // begins, refreshes on a ~2s cadence, and is re-triggered after each
  // intermediate send (delivering a message clears Telegram's typing bubble).
  const typing = hooks.sendTyping
    ? new TypingKeepAlive(hooks.sendTyping)
    : null;
  typing?.start();

  try {
    const agentResult = await getTelegramContext().runAgent({
      agentId: target.agent.id,
      message: data.text,
      attachments: attachments.length > 0 ? attachments : undefined,
      sessionKey,
      source: "telegram",
      context,
    });

    if (agentResult.meta.queued) return;

    // Thread overflow chunks as replies to the previous chunk so a long answer
    // reads as one grouped thread. The reply target resets per payload.
    for (const payload of agentResult.payloads) {
      if (!payload.text) continue;
      const html = renderMarkdown(payload.text);
      let replyToMessageId: number | undefined;
      let first = true;
      for (const chunk of splitMessage(html)) {
        const sentId = await send(chunk, {
          parseMode: "HTML",
          replyToMessageId: first ? undefined : replyToMessageId,
        });
        if (sentId !== undefined) replyToMessageId = sentId;
        first = false;
        // Re-trigger typing: a delivered message clears Telegram's bubble.
        typing?.poke();
      }
    }
  } catch (err) {
    console.error(`${target.logPrefix} Error:`, err);
    await send("Sorry, I encountered an error processing your message.");
  } finally {
    typing?.stop();
  }
}
