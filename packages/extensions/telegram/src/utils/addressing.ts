import type { Message, MessageEntity, User } from "grammy/types";

/**
 * The subset of an inbound message needed to decide whether the bot was
 * addressed. Kept structural (not a grammY `Context`) so the rule is unit
 * testable without standing up a bot.
 */
export type AddressableMessage = {
  text?: string;
  caption?: string;
  entities?: MessageEntity[];
  caption_entities?: MessageEntity[];
  reply_to_message?: { from?: User };
};

/**
 * Decide whether the bot was addressed in a group chat. True when the message
 * @mentions the bot's username, replies to one of the bot's own messages, or is
 * a bot command (a leading `/...`, optionally `/cmd@botname` targeting this
 * bot). This gates group chats only — private chats are always treated as
 * addressed by the caller — so the bot joins a conversation when spoken to
 * without hijacking every message.
 */
export function isBotAddressed(
  message: AddressableMessage,
  bot: { id?: number; username?: string }
): boolean {
  // Reply to one of the bot's own messages.
  const repliedFromId = message.reply_to_message?.from?.id;
  if (repliedFromId !== undefined && bot.id !== undefined && repliedFromId === bot.id) {
    return true;
  }

  // The text part is the message text, or the caption when media is attached.
  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities ?? [];

  for (const entity of entities) {
    const fragment = text.slice(entity.offset, entity.offset + entity.length);

    // Bot commands at the start of the message: `/cmd` or `/cmd@botname`.
    if (entity.type === "bot_command" && entity.offset === 0) {
      const at = fragment.indexOf("@");
      if (at === -1) return true;
      if (bot.username && fragment.slice(at + 1) === bot.username) return true;
      continue;
    }

    // Plain @mention of the bot's username.
    if (entity.type === "mention" && bot.username) {
      if (fragment === `@${bot.username}`) return true;
      continue;
    }

    // text_mention carries the mentioned user inline (no username required).
    if (
      entity.type === "text_mention" &&
      bot.id !== undefined &&
      (entity as MessageEntity & { user?: User }).user?.id === bot.id
    ) {
      return true;
    }
  }

  return false;
}

/** Narrow a grammY message to the structural shape {@link isBotAddressed} needs. */
export function toAddressableMessage(message: Message): AddressableMessage {
  return {
    text: message.text,
    caption: message.caption,
    entities: message.entities,
    caption_entities: message.caption_entities,
    reply_to_message: message.reply_to_message
      ? { from: message.reply_to_message.from }
      : undefined,
  };
}
