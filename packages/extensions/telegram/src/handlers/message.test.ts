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

  it("ignores group messages that do not address the bot", () => {
    expect(
      processMessage(makeData({ chatType: "group", isAddressed: false }))
    ).toMatchObject({
      shouldReply: false,
      reason: "not_addressed",
    });
  });

  it("replies to a group message that addresses the bot", () => {
    expect(
      processMessage(
        makeData({ chatType: "supergroup", isAddressed: true })
      )
    ).toEqual({ shouldReply: true });
  });

  it("ignores empty messages", () => {
    expect(processMessage(makeData({ text: "   " }))).toMatchObject({
      shouldReply: false,
      reason: "empty_message",
    });
  });

  it("replies to a media-only message with no caption", () => {
    expect(
      processMessage(
        makeData({ text: "", media: [{ fileId: "f1", kind: "photo" }] })
      )
    ).toEqual({ shouldReply: true });
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
    expect(send).toHaveBeenCalledWith(
      "hi back",
      expect.objectContaining({ parseMode: "HTML" })
    );
  });

  it("downloads media and passes attachments plus the caption to the agent", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "got it" }],
      meta: { durationMs: 1, sessionId: "s1" },
    });
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);
    const attachment = { path: "/tmp/x.png", mimeType: "image/png" };
    const collectAttachments = vi.fn().mockResolvedValue([attachment]);

    await handleTelegramMessage(
      makeData({
        text: "look at this",
        media: [{ fileId: "f1", kind: "photo" }],
      }),
      { agent, logPrefix: "[t]" },
      send,
      { collectAttachments }
    );

    expect(collectAttachments).toHaveBeenCalledWith([
      { fileId: "f1", kind: "photo" },
    ]);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "look at this",
        attachments: [attachment],
      })
    );
  });

  it("runs a media-only message with the attachment and empty text", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "seen" }],
      meta: { durationMs: 1, sessionId: "s1" },
    });
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);
    const attachment = { path: "/tmp/x.pdf", mimeType: "application/pdf" };
    const collectAttachments = vi.fn().mockResolvedValue([attachment]);

    await handleTelegramMessage(
      makeData({ text: "", media: [{ fileId: "f1", kind: "document" }] }),
      { agent, logPrefix: "[t]" },
      send,
      { collectAttachments }
    );

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ message: "", attachments: [attachment] })
    );
  });

  it("does not run the agent when media-only download yields nothing", async () => {
    const runAgent = vi.fn();
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);
    const collectAttachments = vi.fn().mockResolvedValue([]);

    await handleTelegramMessage(
      makeData({ text: "", media: [{ fileId: "f1", kind: "photo" }] }),
      { agent, logPrefix: "[t]" },
      send,
      { collectAttachments }
    );

    expect(runAgent).not.toHaveBeenCalled();
  });

  it("surfaces a friendly error when media download throws", async () => {
    const runAgent = vi.fn();
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);
    const collectAttachments = vi.fn().mockRejectedValue(new Error("boom"));

    await handleTelegramMessage(
      makeData({ text: "hi", media: [{ fileId: "f1", kind: "photo" }] }),
      { agent, logPrefix: "[t]" },
      send,
      { collectAttachments }
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Sorry, I couldn't download the attached media. Please try again."
    );
  });

  it("threads overflow chunks as replies to the previous chunk", async () => {
    const long = "word ".repeat(2000).trim(); // > 4096 chars -> multiple chunks
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: long }],
      meta: { durationMs: 1, sessionId: "s1" },
    });
    setTelegramContext({ runAgent } as never);
    // Each send returns an incrementing message id.
    let nextId = 100;
    const send = vi.fn().mockImplementation(async () => nextId++);

    await handleTelegramMessage(makeData(), { agent, logPrefix: "[t]" }, send);

    expect(send.mock.calls.length).toBeGreaterThan(1);
    // First chunk is not a reply.
    expect(send.mock.calls[0][1]).toMatchObject({
      parseMode: "HTML",
      replyToMessageId: undefined,
    });
    // Subsequent chunks reply to the id returned by the previous send.
    for (let i = 1; i < send.mock.calls.length; i++) {
      expect(send.mock.calls[i][1].replyToMessageId).toBe(99 + i);
    }
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

  it("ignores unaddressed group messages without running the agent", async () => {
    const runAgent = vi.fn();
    setTelegramContext({ runAgent } as never);
    const send = vi.fn();

    await handleTelegramMessage(
      makeData({ chatType: "supergroup", isAddressed: false }),
      { agent, logPrefix: "[t]" },
      send
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("dispatches an addressed group message to the shared per-chat session", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "group reply" }],
      meta: { durationMs: 1, sessionId: "s1" },
    });
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);

    await handleTelegramMessage(
      makeData({ chatId: -100200, chatType: "supergroup", isAddressed: true }),
      { agent, logPrefix: "[t]" },
      send
    );

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        sessionKey: "telegram:-100200",
        source: "telegram",
      })
    );
    expect(send).toHaveBeenCalledWith(
      "group reply",
      expect.objectContaining({ parseMode: "HTML" })
    );
  });

  it("keeps DMs isolated on the main session", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "dm reply" }],
      meta: { durationMs: 1, sessionId: "s1" },
    });
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);

    await handleTelegramMessage(
      makeData({ chatId: 777 }),
      { agent, logPrefix: "[t]" },
      send
    );

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: DEFAULT_MAIN_KEY })
    );
  });

  it("starts typing when the turn begins and re-triggers after each send", async () => {
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "part one" }, { text: "part two" }],
      meta: { durationMs: 1, sessionId: "s1" },
    });
    setTelegramContext({ runAgent } as never);
    const send = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);

    await handleTelegramMessage(
      makeData(),
      { agent, logPrefix: "[t]" },
      send,
      { sendTyping }
    );

    // 1 initial start + 1 poke per delivered message.
    expect(sendTyping).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops typing on a queued run without leaking the keep-alive loop", async () => {
    vi.useFakeTimers();
    try {
      const runAgent = vi.fn().mockResolvedValue({
        payloads: [{ text: "ignored" }],
        meta: { durationMs: 1, sessionId: "s1", queued: true },
      });
      setTelegramContext({ runAgent } as never);
      const send = vi.fn().mockResolvedValue(undefined);
      const sendTyping = vi.fn().mockResolvedValue(undefined);

      await handleTelegramMessage(
        makeData(),
        { agent, logPrefix: "[t]" },
        send,
        { sendTyping }
      );

      const callsAfterTurn = sendTyping.mock.calls.length;
      vi.advanceTimersByTime(10000);
      expect(sendTyping).toHaveBeenCalledTimes(callsAfterTurn);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops typing when the run throws", async () => {
    vi.useFakeTimers();
    try {
      const runAgent = vi.fn().mockRejectedValue(new Error("boom"));
      setTelegramContext({ runAgent } as never);
      const send = vi.fn().mockResolvedValue(undefined);
      const sendTyping = vi.fn().mockResolvedValue(undefined);

      await handleTelegramMessage(
        makeData(),
        { agent, logPrefix: "[t]" },
        send,
        { sendTyping }
      );

      const callsAfterError = sendTyping.mock.calls.length;
      vi.advanceTimersByTime(10000);
      // Loop stopped in finally: no further refreshes after the error.
      expect(sendTyping).toHaveBeenCalledTimes(callsAfterError);
    } finally {
      vi.useRealTimers();
    }
  });
});
