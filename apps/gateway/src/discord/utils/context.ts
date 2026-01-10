import type { AgentContext, DiscordContext, DiscordContextBlock } from "@aihub/shared";

/**
 * Render a DiscordContextBlock into a human-readable string
 */
function renderBlock(block: DiscordContextBlock): string {
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
      const lines = block.messages.map((m) => {
        const time = new Date(m.timestamp).toISOString();
        return `[${time}] ${m.author}: ${m.content}`;
      });
      return `Recent messages:\n${lines.join("\n")}`;
    }
    case "reaction": {
      const verb = block.action === "add" ? "reacted with" : "removed reaction";
      return `${block.user} ${verb} ${block.emoji} on message ${block.messageId}`;
    }
    default:
      return "";
  }
}

/**
 * Render a DiscordContext into a preamble string for injection into prompts
 */
export function renderDiscordContext(ctx: DiscordContext): string {
  const parts: string[] = [];
  for (const block of ctx.blocks) {
    const rendered = renderBlock(block);
    if (rendered) parts.push(rendered);
  }
  if (parts.length === 0) return "";
  return `[SYSTEM CONTEXT - Discord]\n${parts.join("\n\n")}\n[END CONTEXT]`;
}

/**
 * Render any AgentContext into a preamble string
 */
export function renderAgentContext(ctx: AgentContext): string {
  if (ctx.kind === "discord") {
    return renderDiscordContext(ctx);
  }
  return "";
}

/**
 * Build Discord context blocks from channel/thread metadata
 */
export function buildDiscordContext(opts: {
  channelName?: string;
  channelTopic?: string;
  threadStarter?: { author: string; content: string; timestamp: number };
  history?: Array<{ author: string; content: string; timestamp: number }>;
  reaction?: { emoji: string; user: string; messageId: string; action: "add" | "remove" };
}): DiscordContext {
  const blocks: DiscordContextBlock[] = [];

  if (opts.channelName) {
    blocks.push({ type: "channel_name", name: opts.channelName });
  }
  if (opts.channelTopic) {
    blocks.push({ type: "channel_topic", topic: opts.channelTopic });
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
