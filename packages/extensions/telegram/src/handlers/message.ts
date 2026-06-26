import type { AgentConfig } from "@aihub/shared";
import { DEFAULT_MAIN_KEY, buildTelegramContext } from "@aihub/shared";
import { getTelegramContext } from "../context.js";
import { isSenderAllowed } from "../utils/allowlist.js";
import { splitMessage } from "../utils/chunk.js";
import { TypingKeepAlive, type SendTyping } from "../utils/typing.js";

export type TelegramMessageData = {
  chatId: number;
  chatType: string;
  text: string;
  userId?: number;
  senderName: string;
  isBot: boolean;
};

export type TelegramReplyTarget = {
  agent: AgentConfig;
  logPrefix: string;
};

export type TelegramSend = (text: string) => Promise<void>;

export type TelegramHandlerHooks = {
  /** Best-effort sender for Telegram's "typing" chat action. */
  sendTyping?: SendTyping;
};

export type TelegramPipelineResult = {
  shouldReply: boolean;
  reason?: string;
};

/**
 * Decide whether an inbound message should be handled. Walking-skeleton slice:
 * DMs only (private chats), allowlist stubbed open, the bot's own messages
 * ignored. Groups are explicitly out of this slice.
 */
export function processMessage(
  data: TelegramMessageData
): TelegramPipelineResult {
  if (data.isBot) {
    return { shouldReply: false, reason: "author_is_bot" };
  }
  if (data.chatType !== "private") {
    return { shouldReply: false, reason: "not_a_dm" };
  }
  if (!isSenderAllowed(data.userId)) {
    return { shouldReply: false, reason: "sender_not_allowed" };
  }
  if (!data.text.trim()) {
    return { shouldReply: false, reason: "empty_message" };
  }
  return { shouldReply: true };
}

export async function handleTelegramMessage(
  data: TelegramMessageData,
  target: TelegramReplyTarget,
  send: TelegramSend,
  hooks: TelegramHandlerHooks = {}
): Promise<void> {
  const result = processMessage(data);
  if (!result.shouldReply) {
    if (result.reason && result.reason !== "author_is_bot") {
      console.debug(`${target.logPrefix} Ignored: ${result.reason}`);
    }
    return;
  }

  // DMs resolve to the agent's main session, matching discord/slack DM handling.
  const sessionKey = DEFAULT_MAIN_KEY;
  const context = buildTelegramContext({
    metadata: {
      channel: "telegram",
      place: `direct message / ${data.senderName}`,
      conversationType: "direct_message",
      sender: data.senderName,
    },
  });

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
      sessionKey,
      source: "telegram",
      context,
    });

    if (agentResult.meta.queued) return;

    for (const payload of agentResult.payloads) {
      if (!payload.text) continue;
      for (const chunk of splitMessage(payload.text)) {
        await send(chunk);
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
