import { describe, expect, it } from "vitest";
import { buildSlackContext, renderSlackContext } from "./context.js";

describe("buildSlackContext", () => {
  it("builds empty Slack context", () => {
    expect(buildSlackContext({})).toEqual({ kind: "slack", blocks: [] });
  });

  it("adds channel metadata, thread parent, and history", () => {
    const ctx = buildSlackContext({
      channelName: "general",
      channelTopic: "updates",
      threadParent: { author: "U1", content: "root", timestamp: 1 },
      history: [{ author: "U2", content: "hi", timestamp: 2 }],
    });

    expect(ctx.blocks.map((block) => block.type)).toEqual([
      "channel_name",
      "channel_topic",
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
  it("renders formatting guidance for empty context", () => {
    const rendered = renderSlackContext(buildSlackContext({}));
    expect(rendered).toContain("[SYSTEM CONTEXT - Slack]");
    expect(rendered).toContain("[FORMATTING]");
    expect(rendered).toContain("Bold: *text*");
  });

  it("renders Slack context blocks", () => {
    const rendered = renderSlackContext(
      buildSlackContext({
        channelName: "dev",
        channelTopic: "shipping",
        history: [{ author: "U1", content: "hello", timestamp: 1 }],
      })
    );

    expect(rendered).toContain("[SYSTEM CONTEXT - Slack]");
    expect(rendered).toContain("Channel: #dev");
    expect(rendered).toContain("Topic: shipping");
    expect(rendered).toContain("U1: hello");
    expect(rendered).toContain("Links: <url|text>");
  });
});
