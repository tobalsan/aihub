import { describe, expect, it } from "vitest";
import { buildSlackContext, renderSlackContext } from "./context.js";

describe("buildSlackContext", () => {
  it("builds empty Slack context", () => {
    expect(buildSlackContext({})).toEqual({ kind: "slack", blocks: [] });
  });

  it("adds normalized metadata, thread parent, and history", () => {
    const ctx = buildSlackContext({
      metadata: {
        channel: "slack",
        place: "#general / thread:1.1",
        conversationType: "thread_reply",
        sender: "alice",
      },
      channelName: "general",
      channelTopic: "updates",
      threadName: "thread:1.1",
      threadParent: { author: "U1", content: "root", timestamp: 1 },
      history: [{ author: "U2", content: "hi", timestamp: 2 }],
    });

    expect(ctx.blocks.map((block) => block.type)).toEqual([
      "metadata",
      "channel_name",
      "channel_topic",
      "thread_name",
      "thread_starter",
      "history",
    ]);
  });

  it("adds reaction context", () => {
    const ctx = buildSlackContext({
      reaction: {
        emoji: "eyes",
        user: "U1",
        messageId: "1.1",
        action: "add",
      },
    });
    expect(ctx.blocks[0]).toEqual({
      type: "reaction",
      emoji: "eyes",
      user: "U1",
      messageId: "1.1",
      action: "add",
    });
  });
});

describe("renderSlackContext", () => {
  it("returns empty string when message metadata is missing", () => {
    const rendered = renderSlackContext(buildSlackContext({}));
    expect(rendered).toBe("");
  });

  it("renders Slack context blocks", () => {
    const rendered = renderSlackContext(
      buildSlackContext({
        metadata: {
          channel: "slack",
          place: "#dev / thread:1.1",
          conversationType: "thread_reply",
          sender: "alice",
        },
        channelName: "dev",
        channelTopic: "shipping",
        threadName: "thread:1.1",
        threadParent: { author: "bob", content: "root", timestamp: 1 },
        history: [{ author: "U1", content: "hello", timestamp: 1 }],
      })
    );

    expect(rendered).toContain("[CHANNEL CONTEXT]");
    expect(rendered).toContain("channel: slack");
    expect(rendered).toContain("place: #dev / thread:1.1");
    expect(rendered).toContain("conversation_type: thread_reply");
    expect(rendered).toContain("sender: alice");
    expect(rendered).toContain("channel_name: #dev");
    expect(rendered).toContain("channel_topic: shipping");
    expect(rendered).toContain("thread_name: thread:1.1");
    expect(rendered).toContain("thread_starter: bob at 1970-01-01T00:00:00.001Z - root");
    expect(rendered).toContain("- [1970-01-01T00:00:00.001Z] U1: hello");
    expect(rendered).toContain("Links: <url|text>");
  });
});
