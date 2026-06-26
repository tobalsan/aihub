import { DEFAULT_MAIN_KEY, type AgentConfig } from "@aihub/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleTelegramMessage,
  processMessage,
  type TelegramMessageData,
} from "./message.js";
import { setTelegramContext, clearTelegramContext } from "../context.js";

function makeData(
  overrides: Partial<TelegramMessageData> = {}
): TelegramMessageData {
  return {
    chatId: 123,
    chatType: "private",
    text: "hello",
    userId: 42,
    senderName: "alice",
    isBot: false,
    ...overrides,
  };
}

const agent = { id: "main" } as AgentConfig;

describe("processMessage", () => {
  it("replies to a DM", () => {
    expect(processMessage(makeData())).toEqual({ shouldReply: true });
  });

  it("ignores the bot's own messages", () => {
    expect(processMessage(makeData({ isBot: true }))).toMatchObject({
      shouldReply: false,
      reason: "author_is_bot",
    });
  });

  it("ignores non-DM (group) chats", () => {
    expect(processMessage(makeData({ chatType: "group" }))).toMatchObject({
      shouldReply: false,
      reason: "not_a_dm",
    });
  });

  it("ignores empty messages", () => {
    expect(processMessage(makeData({ text: "   " }))).toMatchObject({
      shouldReply: false,
      reason: "empty_message",
    });
  });
});

describe("handleTelegramMessage", () => {
  afterEach(() => clearTelegramContext());

  it("dispatches a DM to the main session and replies", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "hi back" }],
      meta: { durationMs: 1, sessionId: "s1" },
    });
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);

    await handleTelegramMessage(makeData(), { agent, logPrefix: "[t]" }, send);

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        message: "hello",
        sessionKey: DEFAULT_MAIN_KEY,
        source: "telegram",
      })
    );
    expect(send).toHaveBeenCalledWith("hi back");
  });

  it("does not reply when the run is queued", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "ignored" }],
      meta: { durationMs: 1, sessionId: "s1", queued: true },
    });
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);

    await handleTelegramMessage(makeData(), { agent, logPrefix: "[t]" }, send);

    expect(send).not.toHaveBeenCalled();
  });

  it("sends an error message when the run throws", async () => {
    const runAgent = vi.fn().mockRejectedValue(new Error("boom"));
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);

    await handleTelegramMessage(makeData(), { agent, logPrefix: "[t]" }, send);

    expect(send).toHaveBeenCalledWith(
      "Sorry, I encountered an error processing your message."
    );
  });

  it("ignores group messages without running the agent", async () => {
    const runAgent = vi.fn();
    setTelegramContext({ runAgent } as never);
    const send = vi.fn();

    await handleTelegramMessage(
      makeData({ chatType: "supergroup" }),
      { agent, logPrefix: "[t]" },
      send
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
