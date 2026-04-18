import { App } from "@slack/bolt";
import type {
  AgentConfig,
  SlackAgentConfig,
  SlackComponentChannelConfig,
  SlackComponentConfig,
  SlackComponentDmConfig,
} from "@aihub/shared";
import { DEFAULT_MAIN_KEY } from "@aihub/shared";
import { getSlackContext } from "./context.js";
import { processMessage, type MessageData } from "./handlers/message.js";
import {
  formatReactionMessage,
  processReaction,
  type ReactionData,
} from "./handlers/reactions.js";
import {
  handleAbortCommand,
  handleHelpCommand,
  handleNewCommand,
  handlePingCommand,
  type SlackCommandData,
  type SlackCommandTarget,
  type SlackRespond,
} from "./handlers/commands.js";
import { matchesUserAllowlist } from "./utils/allowlist.js";
import { splitMessage } from "./utils/chunk.js";
import { buildSlackContext } from "./utils/context.js";
import { clearHistory, getHistory, recordMessage } from "./utils/history.js";
import { markdownToMrkdwn } from "./utils/mrkdwn.js";
import { getThreadParent, resolveReplyThreadTs } from "./utils/threads.js";
import {
  startThinkingReaction,
  stopAllThinkingReactions,
  stopThinkingReaction,
} from "./utils/typing.js";
import type { SlackWebClient } from "./types.js";

export type SlackBot = {
  app: App;
  agentId: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type SlackMessageTarget = {
  agent: AgentConfig;
  config: SlackComponentConfig;
  channelConfig?: SlackComponentChannelConfig;
  dmConfig?: SlackComponentDmConfig;
  isMainSession: boolean;
  logPrefix: string;
};

type SlackReactionTarget = {
  agent: AgentConfig;
  config: SlackComponentConfig;
  logPrefix: string;
};

type ThinkingStreamDisplay = {
  cleanup: () => Promise<void>;
  setSessionId: (sessionId: string | undefined) => void;
};

const MAX_THINKING_CHARS = 3000;
const THINKING_UPDATE_INTERVAL_MS = 3000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function slackTsToMs(ts: string | undefined): number {
  if (!ts) return Date.now();
  const parsed = Number(ts) * 1000;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toMessageData(raw: unknown, isAppMention = false): MessageData | null {
  const event = asRecord(raw);
  const ts = asString(event.ts);
  const channel = asString(event.channel);
  if (!ts || !channel) return null;

  return {
    ts,
    text: asString(event.text) ?? "",
    channel,
    user: asString(event.user),
    bot_id: asString(event.bot_id),
    channel_type: asString(event.channel_type),
    thread_ts: asString(event.thread_ts),
    isAppMention,
  };
}

function toReactionData(raw: unknown): ReactionData | null {
  const event = asRecord(raw);
  const item = asRecord(event.item);
  const reaction = asString(event.reaction);
  const user = asString(event.user);
  if (!reaction || !user) return null;
  return {
    reaction,
    user,
    item: {
      channel: asString(item.channel),
      ts: asString(item.ts),
    },
  };
}

async function getChannelMetadata(client: SlackWebClient, channel: string) {
  try {
    const result = await client.conversations.info({ channel });
    return {
      name: result.channel?.name,
      topic: result.channel?.topic?.value,
    };
  } catch {
    return {};
  }
}

async function sendSlackReply(
  client: SlackWebClient,
  channel: string,
  payloads: Array<{ text?: string }>,
  threadTs?: string
): Promise<void> {
  for (const payload of payloads) {
    if (!payload.text) continue;
    const text = markdownToMrkdwn(payload.text);
    for (const chunk of splitMessage(text)) {
      await client.chat.postMessage({
        channel,
        text: chunk,
        mrkdwn: true,
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false,
      });
    }
  }
}

async function sendSlackError(
  client: SlackWebClient,
  channel: string,
  threadTs?: string
): Promise<void> {
  await client.chat.postMessage({
    channel,
    text: "Sorry, I encountered an error processing your message.",
    mrkdwn: true,
    thread_ts: threadTs,
  });
}

function formatThinkingMessage(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const truncated =
    trimmed.length > MAX_THINKING_CHARS
      ? trimmed.slice(0, MAX_THINKING_CHARS) + "…"
      : trimmed;
  // Break into lines after sentences (.) and dashes (-)
  const formatted = truncated
    .replace(/\.\s+/g, ".\n")
    .replace(/ - /g, "\n- ");
  return `🧠 Thinking:\n${formatted}`;
}

function startThinkingStreamDisplay(params: {
  client: SlackWebClient;
  channel: string;
  threadTs: string;
  agentId: string;
  sessionKey: string;
  deleteOnComplete: boolean;
  logPrefix: string;
}): ThinkingStreamDisplay {
  const {
    client,
    channel,
    threadTs,
    agentId,
    sessionKey,
    deleteOnComplete,
    logPrefix,
  } = params;
  let messageTs: string | undefined;
  let matchedSessionId: string | undefined;
  let closed = false;
  let unsubscribe: () => void = () => {};
  let posting = false;
  let pendingPost: Promise<void> | null = null;
  let latestText: string | undefined;
  let lastUpdateTime = 0;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let accumulatedThinking = "";

  const setSessionId = (sessionId: string | undefined) => {
    if (!sessionId) return;
    matchedSessionId = sessionId;
  };

  const matchesRun = (event: {
    agentId: string;
    sessionId: string;
    sessionKey?: string;
  }) => {
    if (event.agentId !== agentId) return false;
    if (matchedSessionId) return event.sessionId === matchedSessionId;
    if (event.sessionKey !== sessionKey) return false;
    matchedSessionId = event.sessionId;
    return true;
  };

  const doUpdate = async (text: string) => {
    if (!messageTs || closed) return;
    try {
      await client.chat.update({ channel, ts: messageTs, text, mrkdwn: true });
      lastUpdateTime = Date.now();
    } catch (err) {
      console.debug(`${logPrefix} Thinking message update failed:`, err);
    }
  };

  const publishThinking = async (text: string) => {
    latestText = text;

    // First message: post it immediately
    if (!messageTs && !posting) {
      posting = true;
      pendingPost = (async () => {
        try {
          const result = await client.chat.postMessage({
            channel,
            text,
            mrkdwn: true,
            thread_ts: threadTs,
            unfurl_links: false,
            unfurl_media: false,
          });
          messageTs = result.ts;
          lastUpdateTime = Date.now();
        } catch (err) {
          console.debug(`${logPrefix} Thinking message post failed:`, err);
        } finally {
          posting = false;
          pendingPost = null;
        }
      })();
      await pendingPost;
      return;
    }

    // Still posting the first message — just buffer
    if (posting) return;

    // Throttle updates: if enough time has passed, update now
    const elapsed = Date.now() - lastUpdateTime;
    if (elapsed >= THINKING_UPDATE_INTERVAL_MS) {
      if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
      await doUpdate(text);
    } else if (!throttleTimer) {
      // Schedule a trailing update
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        if (!closed && latestText && messageTs) {
          doUpdate(latestText);
        }
      }, THINKING_UPDATE_INTERVAL_MS - elapsed);
    }
  };

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
    await pendingPost;
    if (!deleteOnComplete || !messageTs) return;
    try {
      await client.chat.delete({ channel, ts: messageTs });
    } catch (err) {
      console.debug(`${logPrefix} Thinking message cleanup failed:`, err);
    }
  };

  unsubscribe = getSlackContext().subscribe("agent.stream", async (payload) => {
    const event = payload as {
      type: "thinking" | "done" | "error";
      data?: string;
      agentId: string;
      sessionId: string;
      sessionKey?: string;
    };
    if (!matchesRun(event)) return;
    if (event.type === "thinking") {
      if (closed) return;
      accumulatedThinking += event.data ?? "";
      const text = formatThinkingMessage(accumulatedThinking);
      try {
        await publishThinking(text);
      } catch (err) {
        console.debug(`${logPrefix} Thinking message update failed:`, err);
      }
      return;
    }
    if (event.type === "done" || event.type === "error") {
      await cleanup();
    }
  });

  return { cleanup, setSessionId };
}

async function handleSlackMessage(
  data: MessageData,
  client: SlackWebClient,
  target: SlackMessageTarget,
  botUserId: string | undefined
): Promise<void> {
  const result = processMessage(data, target.config, botUserId);
  const historyLimit = target.config.historyLimit ?? 20;

  if (!result.shouldReply) {
    if (result.reason && result.reason !== "author_is_bot") {
      console.debug(`${target.logPrefix} Ignored: ${result.reason}`);
    }
    return;
  }

  recordMessage(
    data.channel,
    {
      author: data.user ?? "unknown",
      content: data.text ?? "",
      timestamp: slackTsToMs(data.ts),
    },
    50,
    data.ts
  );

  const content = result.normalizedContent;
  if (!content) return;

  const sessionKey = target.isMainSession
    ? DEFAULT_MAIN_KEY
    : `slack:${data.channel}`;
  const replyThreadTs = resolveReplyThreadTs(
    target.channelConfig?.threadPolicy ?? target.dmConfig?.threadPolicy,
    data.ts,
    data.thread_ts
  );

  await startThinkingReaction(client, data.channel, data.ts, target.agent.id, {
    sessionKey,
  });
  const thinkingDisplay = target.config.showThinking
    ? startThinkingStreamDisplay({
        client,
        channel: data.channel,
        threadTs: replyThreadTs ?? data.ts,
        agentId: target.agent.id,
        sessionKey,
        deleteOnComplete: target.config.deleteThinkingOnComplete !== false,
        logPrefix: target.logPrefix,
      })
    : null;

  try {
    const [channelMeta, threadParent] = await Promise.all([
      getChannelMetadata(client, data.channel),
      getThreadParent(client, data.channel, data.thread_ts, data.ts),
    ]);
    const context = buildSlackContext({
      channelName: channelMeta.name,
      channelTopic: channelMeta.topic,
      threadParent: threadParent ?? undefined,
      history: getHistory(data.channel, historyLimit),
    });

    const agentResult = await getSlackContext().runAgent({
      agentId: target.agent.id,
      message: content,
      sessionKey,
      thinkLevel: target.agent.thinkLevel,
      source: "slack",
      context,
    });
    thinkingDisplay?.setSessionId(agentResult.meta.sessionId);

    if (agentResult.meta.queued) {
      await thinkingDisplay?.cleanup();
      return;
    }

    await sendSlackReply(
      client,
      data.channel,
      agentResult.payloads,
      replyThreadTs
    );

    if (target.config.clearHistoryAfterReply === true) {
      clearHistory(data.channel);
    }
    await thinkingDisplay?.cleanup();
    await stopThinkingReaction(client, data.channel, data.ts);
  } catch (err) {
    console.error(`${target.logPrefix} Error:`, err);
    await sendSlackError(client, data.channel, replyThreadTs);
    await thinkingDisplay?.cleanup();
    await stopThinkingReaction(client, data.channel, data.ts);
  }
}

async function handleSlackReaction(
  data: ReactionData,
  client: SlackWebClient,
  target: SlackReactionTarget,
  action: "add" | "remove"
): Promise<void> {
  const result = processReaction(data, target.config);
  if (!result.shouldProcess || !result.channel || !result.messageTs) {
    if (result.reason && result.reason !== "channel_not_configured") {
      console.debug(`${target.logPrefix} Reaction ignored: ${result.reason}`);
    }
    return;
  }

  const context = buildSlackContext({
    reaction: {
      emoji: data.reaction,
      user: data.user,
      messageId: result.messageTs,
      action,
    },
  });

  try {
    await getSlackContext().runAgent({
      agentId: target.agent.id,
      message: formatReactionMessage(data, action),
      sessionKey: `slack:${result.channel}`,
      thinkLevel: target.agent.thinkLevel,
      source: "slack",
      context,
    });
  } catch (err) {
    console.error(`${target.logPrefix} Reaction error:`, err);
  }
}

function setupSlackBroadcasts(params: {
  client: SlackWebClient;
  textAccumulators: Map<string, string>;
  acceptsAgent: (agentId: string) => boolean;
  getBroadcastChannel: () => string | undefined;
  logPrefix: string;
}): () => void {
  const {
    client,
    textAccumulators,
    acceptsAgent,
    getBroadcastChannel,
    logPrefix,
  } = params;

  return getSlackContext().subscribe("agent.stream", async (payload) => {
    const event = payload as {
      type: "text" | "done" | "error";
      data?: string;
      agentId: string;
      sessionId: string;
      source?: string;
    };
    if (!acceptsAgent(event.agentId)) return;
    if (event.source === "slack" || event.source === "heartbeat") return;

    const broadcastChannel = getBroadcastChannel();
    if (!broadcastChannel) return;

    const mainEntry = await getSlackContext().getSessionEntry(
      event.agentId,
      DEFAULT_MAIN_KEY
    );
    if (!mainEntry || mainEntry.sessionId !== event.sessionId) return;

    const accKey = `${event.agentId}:${event.sessionId}`;
    if (event.type === "text") {
      const current = textAccumulators.get(accKey) ?? "";
      textAccumulators.set(accKey, current + event.data);
      return;
    }
    if (event.type === "done") {
      const text = textAccumulators.get(accKey);
      textAccumulators.delete(accKey);
      if (!text) return;
      try {
        for (const chunk of splitMessage(markdownToMrkdwn(text))) {
          await client.chat.postMessage({
            channel: broadcastChannel,
            text: chunk,
            mrkdwn: true,
            unfurl_links: false,
            unfurl_media: false,
          });
        }
      } catch (err) {
        console.error(`${logPrefix} Broadcast error:`, err);
      }
      return;
    }
    if (event.type === "error") {
      textAccumulators.delete(accKey);
    }
  });
}

function resolveCommandTarget(
  componentConfig: SlackComponentConfig,
  agentsById: Map<string, AgentConfig>,
  fallbackAgent: AgentConfig | undefined,
  command: SlackCommandData
): SlackCommandTarget | null {
  const route = componentConfig.channels?.[command.channel_id];
  if (route) {
    if (
      route.users &&
      route.users.length > 0 &&
      !matchesUserAllowlist(command.user_id, route.users)
    ) {
      return null;
    }
    const agent = agentsById.get(route.agent);
    return agent
      ? {
          agent,
          config: componentConfig,
          channelConfig: route,
          isDm: false,
        }
      : null;
  }

  const isDm = command.channel_id.startsWith("D");
  if (
    isDm &&
    componentConfig.dm?.enabled !== false &&
    componentConfig.dm?.agent
  ) {
    if (
      componentConfig.dm.allowFrom &&
      componentConfig.dm.allowFrom.length > 0 &&
      !matchesUserAllowlist(command.user_id, componentConfig.dm.allowFrom)
    ) {
      return null;
    }
    const agent = agentsById.get(componentConfig.dm.agent);
    return agent ? { agent, config: componentConfig, isDm: true } : null;
  }

  if (!componentConfig.channels && fallbackAgent) {
    return {
      agent: fallbackAgent,
      config: componentConfig,
      isDm,
    };
  }

  return null;
}

export function createSlackBot(
  agents: AgentConfig[],
  componentConfig: SlackComponentConfig
): SlackBot | null {
  if (!componentConfig.token || !componentConfig.appToken) return null;

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const fallbackAgent = agents[0];
  const routedAgentIds = new Set<string>();

  for (const route of Object.values(componentConfig.channels ?? {})) {
    routedAgentIds.add(route.agent);
  }
  if (componentConfig.dm?.agent) {
    routedAgentIds.add(componentConfig.dm.agent);
  }
  if (!componentConfig.channels && fallbackAgent) {
    routedAgentIds.add(fallbackAgent.id);
  }
  if (!agents.some((agent) => routedAgentIds.has(agent.id))) {
    return null;
  }

  const app = new App({
    token: componentConfig.token,
    appToken: componentConfig.appToken,
    socketMode: true,
  });
  const client = app.client as unknown as SlackWebClient;
  const textAccumulators = new Map<string, string>();
  const logPrefix = "[slack]";
  let cleanupBroadcasts: (() => void) | null = null;
  let botUserId: string | undefined;

  const resolveMessageTarget = (
    data: MessageData
  ): SlackMessageTarget | null => {
    if (data.channel_type === "im") {
      if (!componentConfig.dm || componentConfig.dm.enabled === false)
        return null;
      if (!componentConfig.dm.agent) return null;
      const dmAgent = agentsById.get(componentConfig.dm.agent);
      if (!dmAgent) return null;
      return {
        agent: dmAgent,
        config: componentConfig,
        dmConfig: componentConfig.dm,
        isMainSession: true,
        logPrefix: `[slack:${dmAgent.id}]`,
      };
    }

    const route = componentConfig.channels?.[data.channel];
    if (route) {
      const agent = agentsById.get(route.agent);
      if (!agent) return null;
      return {
        agent,
        config: componentConfig,
        channelConfig: route,
        isMainSession: false,
        logPrefix: `[slack:${agent.id}]`,
      };
    }

    if (!componentConfig.channels && fallbackAgent) {
      return {
        agent: fallbackAgent,
        config: componentConfig,
        isMainSession: false,
        logPrefix: `[slack:${fallbackAgent.id}]`,
      };
    }

    return null;
  };

  const resolveReactionTarget = (
    data: ReactionData
  ): SlackReactionTarget | null => {
    const channel = data.item.channel;
    if (!channel) return null;
    const route = componentConfig.channels?.[channel];
    if (!route) return null;
    const agent = agentsById.get(route.agent);
    return agent
      ? { agent, config: componentConfig, logPrefix: `[slack:${agent.id}]` }
      : null;
  };

  app.message(async ({ message, client: eventClient }) => {
    const data = toMessageData(message);
    if (!data) return;
    const target = resolveMessageTarget(data);
    if (!target) return;
    await handleSlackMessage(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      botUserId
    );
  });

  app.event("app_mention", async ({ event, client: eventClient }) => {
    const data = toMessageData(event, true);
    if (!data) return;
    const target = resolveMessageTarget(data);
    if (!target) return;
    await handleSlackMessage(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      botUserId
    );
  });

  app.event("reaction_added", async ({ event, client: eventClient }) => {
    const data = toReactionData(event);
    if (!data) return;
    const target = resolveReactionTarget(data);
    if (!target) return;
    await handleSlackReaction(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      "add"
    );
  });

  app.event("reaction_removed", async ({ event, client: eventClient }) => {
    const data = toReactionData(event);
    if (!data) return;
    const target = resolveReactionTarget(data);
    if (!target) return;
    await handleSlackReaction(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      "remove"
    );
  });

  const registerCommand = (
    name: "/new" | "/stop" | "/help" | "/ping",
    handler: (
      command: SlackCommandData,
      target: SlackCommandTarget,
      respond: SlackRespond
    ) => Promise<void>
  ) => {
    app.command(name, async ({ command, ack, respond }) => {
      await ack();
      const target = resolveCommandTarget(
        componentConfig,
        agentsById,
        fallbackAgent,
        {
          channel_id: command.channel_id,
          user_id: command.user_id,
          text: command.text,
        }
      );
      if (!target) {
        await respond({
          text: "No agent is configured for this Slack route.",
          response_type: "ephemeral",
        });
        return;
      }
      await handler(
        {
          channel_id: command.channel_id,
          user_id: command.user_id,
          text: command.text,
        },
        target,
        respond as SlackRespond
      );
    });
  };

  registerCommand("/new", handleNewCommand);
  registerCommand("/stop", handleAbortCommand);
  registerCommand("/help", handleHelpCommand);
  registerCommand("/ping", handlePingCommand);

  return {
    app,
    agentId: "slack",
    start: async () => {
      try {
        const auth = await client.auth?.test();
        botUserId = auth?.user_id;
      } catch {
        botUserId = undefined;
      }
      cleanupBroadcasts = setupSlackBroadcasts({
        client,
        textAccumulators,
        acceptsAgent: (agentId) => routedAgentIds.has(agentId),
        getBroadcastChannel: () => componentConfig.broadcastToChannel,
        logPrefix,
      });
      await app.start();
      console.log(`${logPrefix} Started Socket Mode bot`);
    },
    stop: async () => {
      cleanupBroadcasts?.();
      cleanupBroadcasts = null;
      textAccumulators.clear();
      stopAllThinkingReactions();
      await app.stop();
    },
  };
}

export function createSlackAgentBot(agent: AgentConfig): SlackBot | null {
  if (!agent.slack?.token || !agent.slack?.appToken) return null;

  const agentSlackConfig = agent.slack as SlackAgentConfig;
  const slackConfig = agent.slack as SlackComponentConfig;
  const app = new App({
    token: agentSlackConfig.token,
    appToken: agentSlackConfig.appToken,
    socketMode: true,
  });
  const client = app.client as unknown as SlackWebClient;
  const textAccumulators = new Map<string, string>();
  const logPrefix = `[slack:${agent.id}]`;
  let cleanupBroadcasts: (() => void) | null = null;
  let botUserId: string | undefined;

  const resolveMessageTarget = (
    data: MessageData
  ): SlackMessageTarget | null => {
    if (data.channel_type === "im") {
      if (!agentSlackConfig.dm || agentSlackConfig.dm.enabled === false) {
        return null;
      }
      if (
        agentSlackConfig.dm.allowFrom &&
        agentSlackConfig.dm.allowFrom.length > 0 &&
        (!data.user ||
          !matchesUserAllowlist(data.user, agentSlackConfig.dm.allowFrom))
      ) {
        return null;
      }
      return {
        agent,
        config: slackConfig,
        dmConfig: agentSlackConfig.dm,
        isMainSession: true,
        logPrefix,
      };
    }

    const channels = agentSlackConfig.channels;
    const channelConfig = channels?.[data.channel];
    if (channels && Object.keys(channels).length > 0 && !channelConfig) {
      return null;
    }

    return {
      agent,
      config: slackConfig,
      channelConfig,
      isMainSession: false,
      logPrefix,
    };
  };

  const resolveReactionTarget = (
    data: ReactionData
  ): SlackReactionTarget | null => {
    const channel = data.item.channel;
    if (!channel) return null;

    const channels = agentSlackConfig.channels;
    if (channels && Object.keys(channels).length > 0 && !channels[channel]) {
      return null;
    }

    const reactionConfig: SlackComponentConfig = channels
      ? slackConfig
      : {
          ...slackConfig,
          channels: {
            [channel]: {
              agent: agent.id,
            },
          },
        };

    return {
      agent,
      config: reactionConfig,
      logPrefix,
    };
  };

  const resolveAgentCommandTarget = (
    command: SlackCommandData
  ): SlackCommandTarget | null => {
    const channelConfig = agentSlackConfig.channels?.[command.channel_id];
    if (channelConfig) {
      if (
        channelConfig.users &&
        channelConfig.users.length > 0 &&
        !matchesUserAllowlist(command.user_id, channelConfig.users)
      ) {
        return null;
      }
      return {
        agent,
        config: slackConfig,
        channelConfig,
        isDm: false,
      };
    }

    const isDm = command.channel_id.startsWith("D");
    if (isDm) {
      if (!agentSlackConfig.dm || agentSlackConfig.dm.enabled === false) {
        return null;
      }
      if (
        agentSlackConfig.dm.allowFrom &&
        agentSlackConfig.dm.allowFrom.length > 0 &&
        !matchesUserAllowlist(command.user_id, agentSlackConfig.dm.allowFrom)
      ) {
        return null;
      }
      return {
        agent,
        config: slackConfig,
        isDm: true,
      };
    }

    if (!agentSlackConfig.channels) {
      return {
        agent,
        config: slackConfig,
        isDm: false,
      };
    }

    return null;
  };

  app.message(async ({ message, client: eventClient }) => {
    const data = toMessageData(message);
    if (!data) return;
    const target = resolveMessageTarget(data);
    if (!target) return;
    await handleSlackMessage(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      botUserId
    );
  });

  app.event("app_mention", async ({ event, client: eventClient }) => {
    const data = toMessageData(event, true);
    if (!data) return;
    const target = resolveMessageTarget(data);
    if (!target) return;
    await handleSlackMessage(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      botUserId
    );
  });

  app.event("reaction_added", async ({ event, client: eventClient }) => {
    const data = toReactionData(event);
    if (!data) return;
    const target = resolveReactionTarget(data);
    if (!target) return;
    await handleSlackReaction(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      "add"
    );
  });

  app.event("reaction_removed", async ({ event, client: eventClient }) => {
    const data = toReactionData(event);
    if (!data) return;
    const target = resolveReactionTarget(data);
    if (!target) return;
    await handleSlackReaction(
      data,
      eventClient as unknown as SlackWebClient,
      target,
      "remove"
    );
  });

  const registerCommand = (
    name: "/new" | "/stop" | "/help" | "/ping",
    handler: (
      command: SlackCommandData,
      target: SlackCommandTarget,
      respond: SlackRespond
    ) => Promise<void>
  ) => {
    app.command(name, async ({ command, ack, respond }) => {
      await ack();
      const target = resolveAgentCommandTarget({
        channel_id: command.channel_id,
        user_id: command.user_id,
        text: command.text,
      });
      if (!target) {
        await respond({
          text: "No agent is configured for this Slack route.",
          response_type: "ephemeral",
        });
        return;
      }
      await handler(
        {
          channel_id: command.channel_id,
          user_id: command.user_id,
          text: command.text,
        },
        target,
        respond as SlackRespond
      );
    });
  };

  registerCommand("/new", handleNewCommand);
  registerCommand("/stop", handleAbortCommand);
  registerCommand("/help", handleHelpCommand);
  registerCommand("/ping", handlePingCommand);

  return {
    app,
    agentId: agent.id,
    start: async () => {
      try {
        const auth = await client.auth?.test();
        botUserId = auth?.user_id;
      } catch {
        botUserId = undefined;
      }
      cleanupBroadcasts = setupSlackBroadcasts({
        client,
        textAccumulators,
        acceptsAgent: (agentId) => agentId === agent.id,
        getBroadcastChannel: () => agentSlackConfig.broadcastToChannel,
        logPrefix,
      });
      await app.start();
      console.log(`${logPrefix} Started Socket Mode bot`);
    },
    stop: async () => {
      cleanupBroadcasts?.();
      cleanupBroadcasts = null;
      textAccumulators.clear();
      stopAllThinkingReactions();
      await app.stop();
    },
  };
}
