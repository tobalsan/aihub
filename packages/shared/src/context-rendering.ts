import type {
  AgentContext,
  ChannelContextMetadata,
  DiscordContext,
  DiscordContextBlock,
  SlackContext,
  SlackContextBlock,
  UserContext,
} from "./types.js";

export const SLACK_FORMATTING = [
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

function renderThreadStarter(
  starter: { author: string; content: string; timestamp: number } | undefined,
  fallback: string
): string {
  if (!starter) return fallback;
  const time = new Date(starter.timestamp).toISOString();
  const content = starter.content.trim() || "(empty)";
  return `${starter.author} at ${time} - ${content}`;
}

function renderHistory(
  history:
    | Array<{ author: string; content: string; timestamp: number }>
    | undefined
): string {
  if (!history || history.length === 0) return "- none";
  return history
    .map((message) => {
      const time = new Date(message.timestamp).toISOString();
      return `- [${time}] ${message.author}: ${message.content}`;
    })
    .join("\n");
}

function getMetadata(
  blocks: DiscordContextBlock[] | SlackContextBlock[]
): ChannelContextMetadata | undefined {
  const block = blocks.find((entry) => entry.type === "metadata");
  if (!block) return undefined;
  return {
    channel: block.channel,
    place: block.place,
    conversationType: block.conversationType,
    sender: block.sender,
  };
}

function getBlock<T extends DiscordContextBlock["type"] | SlackContextBlock["type"]>(
  blocks: DiscordContextBlock[] | SlackContextBlock[],
  type: T
): Extract<DiscordContextBlock | SlackContextBlock, { type: T }> | undefined {
  return blocks.find((block) => block.type === type) as
    | Extract<DiscordContextBlock | SlackContextBlock, { type: T }>
    | undefined;
}

function renderChannelContext(
  metadata: ChannelContextMetadata,
  blocks: DiscordContextBlock[] | SlackContextBlock[],
  options?: { includeSlackFormatting?: boolean }
): string {
  const channelName =
    renderBlockOrFallback(getBlock(blocks, "channel_name"), {
      direct_message: "direct message",
      channel_message: "unknown channel",
      thread_reply: "unknown channel",
    }[metadata.conversationType]) ?? "unknown channel";
  const channelTopic =
    renderBlockOrFallback(getBlock(blocks, "channel_topic"), "unavailable") ??
    "unavailable";
  const threadName =
    renderBlockOrFallback(
      getBlock(blocks, "thread_name"),
      metadata.conversationType === "thread_reply" ? "unavailable" : "not a thread"
    ) ??
    "unavailable";
  const threadStarter = renderThreadStarter(
    getBlock(blocks, "thread_starter"),
    metadata.conversationType === "thread_reply" ? "unavailable" : "not a thread"
  );
  const recentHistory = renderHistory(getBlock(blocks, "history")?.messages);

  const parts = [
    "[CHANNEL CONTEXT]",
    `channel: ${metadata.channel}`,
    `place: ${metadata.place}`,
    `conversation_type: ${metadata.conversationType}`,
    `sender: ${metadata.sender}`,
    `channel_name: ${channelName}`,
    `channel_topic: ${channelTopic}`,
    `thread_name: ${threadName}`,
    `thread_starter: ${threadStarter}`,
    "recent_history:",
    recentHistory,
    "[END CHANNEL CONTEXT]",
  ];

  if (options?.includeSlackFormatting) {
    parts.push("", SLACK_FORMATTING);
  }

  return parts.join("\n");
}

function renderBlockOrFallback(
  block: DiscordContextBlock | SlackContextBlock | undefined,
  fallback: string
): string {
  if (!block) return fallback;
  let rendered = "";
  switch (block.type) {
    case "channel_name":
      rendered = `#${block.name}`;
      break;
    case "channel_topic":
      rendered = block.topic;
      break;
    case "thread_name":
      rendered = block.name;
      break;
    default:
      rendered = "";
      break;
  }
  return rendered || fallback;
}

export function renderDiscordContext(ctx: DiscordContext): string {
  const metadata = getMetadata(ctx.blocks);
  if (!metadata) return "";
  return renderChannelContext(metadata, ctx.blocks);
}

export function renderSlackContext(ctx: SlackContext): string {
  const metadata = getMetadata(ctx.blocks);
  if (!metadata) return "";
  return renderChannelContext(metadata, ctx.blocks, {
    includeSlackFormatting: true,
  });
}

function renderUserContext(ctx: UserContext): string {
  const name = ctx.name?.trim().replace(/\s+/g, " ") || "unknown";
  return [
    "[USER CONTEXT]",
    "context: web UI",
    `name: ${name}`,
    "[END USER CONTEXT]",
  ].join("\n");
}

export function renderAgentContext(ctx: AgentContext): string {
  if (ctx.kind === "discord") return renderDiscordContext(ctx);
  if (ctx.kind === "slack") return renderSlackContext(ctx);
  if (ctx.kind === "web") return renderUserContext(ctx);
  return "";
}

export function buildUserContext(opts: { name?: string | null }): UserContext {
  return { kind: "web", name: opts.name ?? undefined };
}

export function buildDiscordContext(opts: {
  metadata?: ChannelContextMetadata;
  channelName?: string;
  channelTopic?: string;
  threadName?: string;
  threadStarter?: { author: string; content: string; timestamp: number };
  history?: Array<{ author: string; content: string; timestamp: number }>;
  reaction?: { emoji: string; user: string; messageId: string; action: "add" | "remove" };
}): DiscordContext {
  const blocks: DiscordContextBlock[] = [];

  if (opts.metadata) {
    blocks.push({
      type: "metadata",
      channel: "discord",
      place: opts.metadata.place,
      conversationType: opts.metadata.conversationType,
      sender: opts.metadata.sender,
    });
  }
  if (opts.channelName) {
    blocks.push({ type: "channel_name", name: opts.channelName });
  }
  if (opts.channelTopic) {
    blocks.push({ type: "channel_topic", topic: opts.channelTopic });
  }
  if (opts.threadName) {
    blocks.push({ type: "thread_name", name: opts.threadName });
  }
  if (opts.threadStarter) {
    blocks.push({ type: "thread_starter", ...opts.threadStarter });
  }
  if (opts.history && opts.history.length > 0) {
    blocks.push({ type: "history", messages: opts.history });
  }
  if (opts.reaction) {
    blocks.push({ type: "reaction", ...opts.reaction });
  }

  return { kind: "discord", blocks };
}

export function buildSlackContext(opts: {
  metadata?: ChannelContextMetadata;
  channelName?: string;
  channelTopic?: string;
  threadName?: string;
  threadParent?: { author: string; content: string; timestamp: number };
  history?: Array<{ author: string; content: string; timestamp: number }>;
  reaction?: { emoji: string; user: string; messageId: string; action: "add" | "remove" };
}): SlackContext {
  const blocks: SlackContextBlock[] = [];

  if (opts.metadata) {
    blocks.push({
      type: "metadata",
      channel: "slack",
      place: opts.metadata.place,
      conversationType: opts.metadata.conversationType,
      sender: opts.metadata.sender,
    });
  }
  if (opts.channelName) {
    blocks.push({ type: "channel_name", name: opts.channelName });
  }
  if (opts.channelTopic) {
    blocks.push({ type: "channel_topic", topic: opts.channelTopic });
  }
  if (opts.threadName) {
    blocks.push({ type: "thread_name", name: opts.threadName });
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
