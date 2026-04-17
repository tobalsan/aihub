import type { SlackContext, SlackContextBlock } from "@aihub/shared";

const SLACK_FORMATTING = [
  "[FORMATTING]",
  "This conversation is in Slack. Use Slack mrkdwn syntax:",
  "- Bold: *text* (not **text**)",
  "- Italic: _text_ (not *text*)",
  "- Links: <url|text> (not [text](url))",
  "- No markdown tables; use bullet lists instead",
  "- No HTML",
  "- Code blocks: use triple backticks",
  "[END FORMATTING]",
].join("\n");

function renderBlock(block: SlackContextBlock): string {
  switch (block.type) {
    case "channel_name":
      return `Channel: #${block.name}`;
    case "channel_topic":
      return `Topic: ${block.topic}`;
    case "thread_starter": {
      const time = new Date(block.timestamp).toISOString();
      return `Thread started by ${block.author} at ${time}:\n${block.content}`;
    }
    case "history": {
      if (block.messages.length === 0) return "";
      const lines = block.messages.map((message) => {
        const time = new Date(message.timestamp).toISOString();
        return `[${time}] ${message.author}: ${message.content}`;
      });
      return `Recent messages:\n${lines.join("\n")}`;
    }
    case "reaction": {
      const verb = block.action === "add" ? "reacted with" : "removed reaction";
      return `${block.user} ${verb} ${block.emoji} on message ${block.messageId}`;
    }
  }
}

export function renderSlackContext(ctx: SlackContext): string {
  const parts: string[] = [];
  for (const block of ctx.blocks) {
    const rendered = renderBlock(block);
    if (rendered) parts.push(rendered);
  }
  parts.push(SLACK_FORMATTING);
  return `[SYSTEM CONTEXT - Slack]\n${parts.join("\n\n")}\n[END CONTEXT]`;
}

export function buildSlackContext(opts: {
  channelName?: string;
  channelTopic?: string;
  threadParent?: { author: string; content: string; timestamp: number };
  history?: Array<{ author: string; content: string; timestamp: number }>;
  reaction?: {
    emoji: string;
    user: string;
    messageId: string;
    action: "add" | "remove";
  };
}): SlackContext {
  const blocks: SlackContextBlock[] = [];

  if (opts.channelName) {
    blocks.push({ type: "channel_name", name: opts.channelName });
  }
  if (opts.channelTopic) {
    blocks.push({ type: "channel_topic", topic: opts.channelTopic });
  }
  if (opts.threadParent) {
    blocks.push({ type: "thread_starter", ...opts.threadParent });
  }
  if (opts.history && opts.history.length > 0) {
    blocks.push({ type: "history", messages: opts.history });
  }
  if (opts.reaction) {
    blocks.push({ type: "reaction", ...opts.reaction });
  }

  return { kind: "slack", blocks };
}
