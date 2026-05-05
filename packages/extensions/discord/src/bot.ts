import type { CommandInteraction } from "@buape/carbon";
import { MessageType } from "discord-api-types/v10";
import type {
  AgentConfig,
  AgentStreamEvent,
  DiscordComponentConfig,
  DiscordConfig,
  HeartbeatEventPayload,
} from "@aihub/shared";
import { DEFAULT_MAIN_KEY } from "@aihub/shared";
import {
  createCarbonClient,
  getGatewayPlugin,
  type CarbonClient,
  type MessageHandler,
  type ReactionHandler,
  type ReadyHandler,
  type ThreadHandler,
} from "./client.js";
import { processMessage, type MessageData } from "./handlers/message.js";
import { processReaction, formatEmoji, type ReactionData } from "./handlers/reactions.js";
import { createSlashCommands } from "./handlers/commands.js";
import { buildDiscordContext } from "./utils/context.js";
import { getChannelMetadata } from "./utils/channel.js";
import { getThreadStarter } from "./utils/threads.js";
import { recordMessage, getHistory, clearHistory } from "./utils/history.js";
import { splitMessage } from "./utils/chunk.js";
import { startTyping, stopAllTyping } from "./utils/typing.js";
import { getDiscordContext } from "./context.js";

export type DiscordBot = {
  client: CarbonClient;
  agentId: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type DiscordMessageTarget = {
  agent: AgentConfig;
  config: DiscordConfig;
  isMainSession: boolean;
};

type DiscordReactionTarget = {
  agent: AgentConfig;
  config: DiscordConfig;
};

type ResolvedDiscordMessageTarget = DiscordMessageTarget & {
  logPrefix: string;
};

type ResolvedDiscordReactionTarget = DiscordReactionTarget & {
  logPrefix: string;
};

function disconnectGateway(client: CarbonClient): void {
  const gateway = getGatewayPlugin(client);
  if (!gateway) return;
  if (!gateway.isConnected) return;

  try {
    gateway.disconnect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("closed before the connection was established")) {
      throw err;
    }
  }
}

type DiscordBotFactoryOptions = {
  agentId: string;
  token: string;
  applicationId?: string;
  logPrefix: string;
  resolveMessageTarget: (data: MessageData) => ResolvedDiscordMessageTarget | null;
  resolveReactionTarget: (data: ReactionData) => ResolvedDiscordReactionTarget | null;
  createCommands?: () => ReturnType<typeof createSlashCommands> | undefined;
  acceptsAgent: (agentId: string) => boolean;
  getBroadcastChannel: (agentId: string) => string | undefined;
};

type DiscordChannelInfo = {
  id: string;
  type?: number;
  parent_id?: string | null;
  guild_id?: string;
};

function buildComponentDmConfig(enabled: boolean): DiscordConfig["dm"] {
  return {
    enabled,
    groupEnabled: false,
  };
}

function isDiscordThreadType(type: number | undefined): boolean {
  return type === 10 || type === 11 || type === 12;
}

async function sendDiscordReply(
  client: CarbonClient,
  channelId: string,
  payloads: Array<{ text?: string }>,
  replyToMode: DiscordConfig["replyToMode"],
  messageId: string
): Promise<void> {
  const buildBody = (chunk: string, isFirst: boolean) => {
    const body: { content: string; message_reference?: { message_id: string } } = {
      content: chunk,
    };
    if (replyToMode === "all" || (replyToMode === "first" && isFirst)) {
      body.message_reference = { message_id: messageId };
    }
    return body;
  };

  let isFirstChunk = true;
  for (const payload of payloads) {
    if (!payload.text) continue;
    const chunks = splitMessage(payload.text);
    for (const chunk of chunks) {
      await client.rest.post(`/channels/${channelId}/messages`, {
        body: buildBody(chunk, isFirstChunk),
      });
      isFirstChunk = false;
    }
  }
}

async function sendDiscordError(
  client: CarbonClient,
  channelId: string,
  replyToMode: DiscordConfig["replyToMode"],
  messageId: string
): Promise<void> {
  const errorBody: { content: string; message_reference?: { message_id: string } } = {
    content: "Sorry, I encountered an error processing your message.",
  };
  if (replyToMode !== "off") {
    errorBody.message_reference = { message_id: messageId };
  }
  await client.rest.post(`/channels/${channelId}/messages`, {
    body: errorBody,
  });
}

async function handleDiscordMessage(
  data: MessageData,
  client: CarbonClient,
  target: ResolvedDiscordMessageTarget,
  botUserId: string | undefined,
  historyLimit: number,
  clearHistoryAfterReply: boolean,
  replyToMode: DiscordConfig["replyToMode"]
): Promise<void> {
  const result = processMessage(data, target.config, botUserId);

  if (!data.author.bot) {
    recordMessage(
      data.channel_id,
      {
        author: data.author.username ?? data.author.id,
        content: data.content ?? "",
        timestamp: Date.now(),
      },
      historyLimit,
      data.id
    );
  }

  if (!result.shouldReply) {
    if (result.reason && result.reason !== "author_is_bot") {
      console.debug(`${target.logPrefix} Ignored: ${result.reason}`);
    }
    return;
  }

  const content = result.normalizedContent;
  if (!content) return;

  const sessionKey = target.isMainSession
    ? DEFAULT_MAIN_KEY
    : `discord:${data.channel_id}`;

  startTyping(client, data.channel_id, target.agent.id, { sessionKey }, false);

  try {
    const [channelMeta, threadStarter] = await Promise.all([
      getChannelMetadata(client, data.channel_id),
      getThreadStarter(client, data.channel_id),
    ]);
    const parentChannelMeta =
      isDiscordThreadType(channelMeta.type) && channelMeta.parentId
        ? await getChannelMetadata(client, channelMeta.parentId)
        : undefined;
    const sender = data.author.username ?? data.author.id;
    const conversationType = !data.guild_id
      ? "direct_message"
      : isDiscordThreadType(channelMeta.type)
        ? "thread_reply"
        : "channel_message";
    const channelName =
      conversationType === "thread_reply"
        ? parentChannelMeta?.name
        : channelMeta.name;
    const threadName =
      conversationType === "thread_reply"
        ? channelMeta.name ?? `thread:${data.channel_id}`
        : undefined;
    const placeChannel = `#${channelName ?? data.channel_id}`;
    const place =
      conversationType === "direct_message"
        ? `direct message / ${sender}`
        : conversationType === "thread_reply"
          ? `${placeChannel} / ${threadName}`
          : placeChannel;

    const recentHistory = getHistory(data.channel_id, historyLimit);
    const context = buildDiscordContext({
      metadata: {
        channel: "discord",
        place,
        conversationType,
        sender,
      },
      channelName,
      channelTopic:
        conversationType === "thread_reply"
          ? parentChannelMeta?.topic ?? channelMeta.topic
          : channelMeta.topic,
      threadName,
      threadStarter: threadStarter ?? undefined,
      history: recentHistory.length > 0 ? recentHistory : undefined,
    });

    const agentResult = await getDiscordContext().runAgent({
      agentId: target.agent.id,
      message: content,
      sessionKey,
      thinkLevel: target.agent.thinkLevel,
      source: "discord",
      context,
    });

    if (agentResult.meta.queued) {
      startTyping(client, data.channel_id, target.agent.id, { sessionKey }, true);
      return;
    }

    await sendDiscordReply(
      client,
      data.channel_id,
      agentResult.payloads,
      replyToMode,
      data.id
    );

    if (clearHistoryAfterReply) {
      clearHistory(data.channel_id);
    }
  } catch (err) {
    console.error(`${target.logPrefix} Error:`, err);
    await sendDiscordError(client, data.channel_id, replyToMode, data.id);
  }
}

async function handleDiscordReaction(
  data: ReactionData,
  client: CarbonClient,
  target: ResolvedDiscordReactionTarget,
  botUserId: string | undefined,
  added: boolean
): Promise<void> {
  const reactionData: ReactionData = {
    emoji: data.emoji,
    user_id: data.user_id,
    channel_id: data.channel_id,
    message_id: data.message_id,
    guild_id: data.guild_id,
  };

  const guildConfig = data.guild_id
    ? target.config.guilds?.[data.guild_id]
    : undefined;
  const mode = guildConfig?.reactionNotifications ?? "off";

  if (mode === "own" && botUserId) {
    try {
      const msg = (await client.rest.get(
        `/channels/${data.channel_id}/messages/${data.message_id}`
      )) as { author?: { id: string } };
      reactionData.message_author_id = msg?.author?.id;
    } catch {
      return;
    }
  }

  const result = processReaction(reactionData, target.config, botUserId);
  if (!result.shouldProcess) {
    if (result.reason && result.reason !== "reactions_off") {
      console.debug(`${target.logPrefix} Reaction ignored: ${result.reason}`);
    }
    return;
  }

  const context = buildDiscordContext({
    reaction: {
      emoji: formatEmoji(data.emoji),
      user: data.user_id,
      messageId: data.message_id,
      action: added ? "add" : "remove",
    },
  });

  try {
    const action = added ? "reacted with" : "removed reaction";
    const message = `[SYSTEM] User ${data.user_id} ${action} ${formatEmoji(data.emoji)} on message ${data.message_id}`;

    await getDiscordContext().runAgent({
      agentId: target.agent.id,
      message,
      sessionKey: `discord:${data.channel_id}`,
      thinkLevel: target.agent.thinkLevel,
      source: "discord",
      context,
    });
  } catch (err) {
    console.error(`${target.logPrefix} Reaction error:`, err);
  }
}

function toMessageData(data: {
  id: string;
  content?: string | null;
  type?: number;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username?: string;
    discriminator?: string;
    bot?: boolean;
  };
  mentions?: Array<{ id: string }>;
}): MessageData {
  return {
    id: data.id,
    content: data.content ?? "",
    type: data.type,
    channel_id: data.channel_id,
    guild_id: data.guild_id,
    author: {
      id: data.author.id,
      username: data.author.username,
      discriminator: data.author.discriminator,
      bot: data.author.bot,
    },
    mentions: data.mentions,
  };
}

function mentionsBot(data: MessageData, botUserId: string | undefined): boolean {
  return Boolean(botUserId && data.mentions?.some((mention) => mention.id === botUserId));
}

function withoutMentionRequirement(
  config: DiscordConfig,
  guildId: string | undefined,
  channelId: string
): DiscordConfig {
  if (!guildId) return config;

  const guildConfig = config.guilds?.[guildId];
  return {
    ...config,
    guilds: {
      ...config.guilds,
      [guildId]: {
        ...guildConfig,
        requireMention: false,
        reactionNotifications: guildConfig?.reactionNotifications ?? "off",
        channels: {
          ...guildConfig?.channels,
          [channelId]: {
            ...guildConfig?.channels?.[channelId],
            enabled: guildConfig?.channels?.[channelId]?.enabled ?? true,
            requireMention: false,
          },
        },
      },
    },
  };
}

async function enrichThreadParent(
  data: MessageData,
  client: CarbonClient
): Promise<MessageData> {
  if (!data.guild_id) return data;

  try {
    const channel = (await client.rest.get(
      `/channels/${data.channel_id}`
    )) as DiscordChannelInfo;
    if (!isDiscordThreadType(channel.type) || !channel.parent_id) return data;
    return {
      ...data,
      parent_channel_id: channel.parent_id,
    };
  } catch {
    return data;
  }
}

async function resolveTargetForMessage(
  data: MessageData,
  client: CarbonClient,
  resolveMessageTarget: DiscordBotFactoryOptions["resolveMessageTarget"]
): Promise<{ data: MessageData; target: ResolvedDiscordMessageTarget | null }> {
  const target = resolveMessageTarget(data);
  if (target || !data.guild_id) return { data, target };

  const enriched = await enrichThreadParent(data, client);
  if (enriched === data) return { data, target: null };
  return {
    data: enriched,
    target: resolveMessageTarget(enriched),
  };
}

async function getLatestThreadMessage(
  client: CarbonClient,
  threadId: string
): Promise<{
  id: string;
  content?: string;
  type?: number;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username?: string;
    discriminator?: string;
    bot?: boolean;
  };
  mentions?: Array<{ id: string }>;
} | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const messages = (await client.rest.get(
      `/channels/${threadId}/messages?limit=1`
    )) as Array<{
      id: string;
      content?: string;
      type?: number;
      channel_id: string;
      guild_id?: string;
      author: {
        id: string;
        username?: string;
        discriminator?: string;
        bot?: boolean;
      };
      mentions?: Array<{ id: string }>;
    }>;
    if (messages[0]) return messages[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function resolveDiscordClientId(
  token: string,
  applicationId: string | undefined,
  logPrefix: string
): Promise<string | null> {
  if (applicationId) return applicationId;
  try {
    const res = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      return data.id as string;
    }
  } catch {
    // Ignore fetch errors.
  }
  console.error(
    `${logPrefix} Failed to get application ID. Set 'applicationId' in config.`
  );
  return null;
}

function setupDiscordBroadcasts(params: {
  client: CarbonClient;
  logPrefix: string;
  textAccumulators: Map<string, string>;
  acceptsAgent: (agentId: string) => boolean;
  getBroadcastChannel: (agentId: string) => string | undefined;
  getBotUserId: () => string | undefined;
}): () => void {
  const {
    client,
    logPrefix,
    textAccumulators,
    acceptsAgent,
    getBroadcastChannel,
    getBotUserId,
  } = params;

  const unsubscribeBroadcast = getDiscordContext().subscribe(
    "agent.stream",
    async (payload) => {
      const event = payload as AgentStreamEvent;
      if (!acceptsAgent(event.agentId)) return;
      if (event.source === "discord" || event.source === "heartbeat") return;

      const broadcastChannel = getBroadcastChannel(event.agentId);
      if (!broadcastChannel) return;

      const mainEntry = await getDiscordContext().getSessionEntry(
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
          const chunks = splitMessage(text, 2000);
          for (const chunk of chunks) {
            await client.rest.post(`/channels/${broadcastChannel}/messages`, {
              body: { content: chunk },
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
    }
  );

  const unsubscribeHeartbeat = getDiscordContext().subscribe(
    "heartbeat.event",
    async (rawPayload) => {
      const payload = rawPayload as HeartbeatEventPayload;
      if (!acceptsAgent(payload.agentId)) return;
      if (payload.status !== "sent") return;
      if (!payload.to || !payload.alertText) return;

      if (!getBotUserId()) {
        console.warn(`${logPrefix} Heartbeat delivery skipped: bot not ready`);
        return;
      }

      const gateway = getGatewayPlugin(client);
      if (!gateway?.isConnected) {
        console.warn(
          `${logPrefix} Heartbeat delivery skipped: gateway not connected`
        );
        return;
      }

      try {
        const chunks = splitMessage(payload.alertText, 2000);
        for (const chunk of chunks) {
          await client.rest.post(`/channels/${payload.to}/messages`, {
            body: { content: chunk },
          });
        }
        console.log(`${logPrefix} Heartbeat alert delivered to ${payload.to}`);
      } catch (err) {
        console.error(`${logPrefix} Heartbeat delivery error:`, err);
      }
    }
  );

  return () => {
    unsubscribeBroadcast();
    unsubscribeHeartbeat();
  };
}

async function createConfiguredDiscordBot(
  options: DiscordBotFactoryOptions
): Promise<DiscordBot | null> {
  const textAccumulators = new Map<string, string>();
  const handledMessageIds = new Set<string>();
  const handledThreadIds = new Set<string>();
  const unlockedThreadIds = new Set<string>();
  let cleanupBroadcasts: (() => void) | null = null;
  let botUserId: string | undefined;

  const handleCreatedThread = async (
    thread: { id: string; guildId?: string; parentId?: string | null; join?: () => Promise<void> },
    client: CarbonClient
  ) => {
    if (handledThreadIds.has(thread.id)) return;
    handledThreadIds.add(thread.id);

    try {
      await thread.join?.();
    } catch {
      // Already joined, not joinable, or missing permissions. Message routing can
      // still work for threads Discord delivers to the gateway.
    }

    try {
      const message = await getLatestThreadMessage(client, thread.id);
      if (!message) return;
      if (handledMessageIds.has(message.id)) return;
      handledMessageIds.add(message.id);

      const msgData: MessageData = {
        ...toMessageData({
          ...message,
          guild_id: message.guild_id ?? thread.guildId,
        }),
        parent_channel_id: thread.parentId ?? undefined,
      };
      const target = options.resolveMessageTarget(msgData);
      if (!target) return;
      if (mentionsBot(msgData, botUserId)) {
        unlockedThreadIds.add(msgData.channel_id);
      }
      const effectiveTarget =
        unlockedThreadIds.has(msgData.channel_id)
          ? {
              ...target,
              config: withoutMentionRequirement(
                target.config,
                msgData.guild_id,
                msgData.channel_id
              ),
            }
          : target;

      await handleDiscordMessage(
        msgData,
        client,
        effectiveTarget,
        botUserId,
        effectiveTarget.config.historyLimit ?? 20,
        effectiveTarget.config.clearHistoryAfterReply ?? true,
        effectiveTarget.config.replyToMode ?? "off"
      );
    } catch (err) {
      console.debug(`${options.logPrefix} Thread create ignored: ${err}`);
    }
  };

  const handleMessage: MessageHandler = async (data, client) => {
    if (data.type === MessageType.ThreadCreated) {
      await handleCreatedThread(
        {
          id: data.id,
          guildId: data.guild_id,
          parentId: data.channel_id,
          join: async () => {
            await client.rest.put(`/channels/${data.id}/thread-members/@me`);
          },
        },
        client
      );
      return;
    }

    if (handledMessageIds.has(data.id)) return;
    handledMessageIds.add(data.id);

    const resolved = await resolveTargetForMessage(
      toMessageData(data),
      client,
      options.resolveMessageTarget
    );
    const { data: msgData, target } = resolved;
    if (!target) return;

    const shouldUnlockThread = mentionsBot(msgData, botUserId);
    const threadMessage =
      unlockedThreadIds.has(msgData.channel_id) || shouldUnlockThread
        ? await enrichThreadParent(msgData, client)
        : msgData;
    const isThreadMessage = Boolean(threadMessage.parent_channel_id);
    if (isThreadMessage && shouldUnlockThread) {
      unlockedThreadIds.add(threadMessage.channel_id);
    }
    const effectiveTarget =
      isThreadMessage && unlockedThreadIds.has(threadMessage.channel_id)
        ? {
            ...target,
            config: withoutMentionRequirement(
              target.config,
              threadMessage.guild_id,
              threadMessage.channel_id
            ),
          }
        : target;

    await handleDiscordMessage(
      threadMessage,
      client,
      effectiveTarget,
      botUserId,
      effectiveTarget.config.historyLimit ?? 20,
      effectiveTarget.config.clearHistoryAfterReply ?? true,
      effectiveTarget.config.replyToMode ?? "off"
    );
  };

  const handleThreadCreate: ThreadHandler = async (data, client) => {
    await handleCreatedThread(data.thread, client);
  };

  const handleReaction: ReactionHandler = async (data, client, added) => {
    const target = options.resolveReactionTarget(data);
    if (!target) return;

    await handleDiscordReaction(
      data,
      client,
      target,
      botUserId,
      added
    );
  };

  const commands = options.applicationId ? options.createCommands?.() : undefined;
  const hasCommands = Boolean(commands);

  const handleReady: ReadyHandler = async (data, client) => {
    botUserId = data.user.id;
    console.log(`${options.logPrefix} Bot ready as ${data.user.username} (${botUserId})`);

    if (hasCommands) {
      try {
        await client.handleDeployRequest();
        console.log(`${options.logPrefix} Slash commands deployed`);
      } catch (err) {
        console.error(`${options.logPrefix} Failed to deploy commands:`, err);
      }
    }
  };

  const clientId = await resolveDiscordClientId(
    options.token,
    options.applicationId,
    options.logPrefix
  );
  if (!clientId) {
    return null;
  }

  const client = createCarbonClient({
    token: options.token,
    clientId,
    commands,
    onMessage: handleMessage,
    onThreadCreate: handleThreadCreate,
    onReaction: handleReaction,
    onReady: handleReady,
  });

  return {
    client,
    agentId: options.agentId,
    start: async () => {
      cleanupBroadcasts = setupDiscordBroadcasts({
        client,
        logPrefix: options.logPrefix,
        textAccumulators,
        acceptsAgent: options.acceptsAgent,
        getBroadcastChannel: options.getBroadcastChannel,
        getBotUserId: () => botUserId,
      });
    },
    stop: async () => {
      cleanupBroadcasts?.();
      cleanupBroadcasts = null;
      textAccumulators.clear();
      handledMessageIds.clear();
      handledThreadIds.clear();
      unlockedThreadIds.clear();
      stopAllTyping();
      disconnectGateway(client);
    },
  };
}

export async function createDiscordBot(agent: AgentConfig): Promise<DiscordBot | null> {
  if (!agent.discord?.token) return null;
  const discordConfig = agent.discord;
  const logPrefix = `[discord:${agent.id}]`;

  return createConfiguredDiscordBot({
    agentId: agent.id,
    token: discordConfig.token,
    applicationId: discordConfig.applicationId,
    logPrefix,
    resolveMessageTarget: (data) => ({
      agent,
      config: discordConfig,
      isMainSession: !data.guild_id || discordConfig.channelId === data.channel_id,
      logPrefix,
    }),
    resolveReactionTarget: () => ({
      agent,
      config: discordConfig,
      logPrefix,
    }),
    createCommands: () => createSlashCommands({ agent }),
    acceptsAgent: (agentId) => agentId === agent.id,
    getBroadcastChannel: () =>
      discordConfig.broadcastToChannel ?? discordConfig.channelId,
  });
}

function buildDiscordRouteConfig(
  componentConfig: DiscordComponentConfig,
  channelId: string,
  guildId: string | undefined,
  requireMention: boolean | undefined
): DiscordConfig {
  return {
    token: componentConfig.token,
    applicationId: componentConfig.applicationId,
    dm: buildComponentDmConfig(false),
    groupPolicy: "allowlist",
    guilds: guildId
      ? {
          [guildId]: {
            requireMention: requireMention ?? true,
            reactionNotifications: "off",
            channels: {
              [channelId]: {
                enabled: true,
                requireMention,
              },
            },
          },
        }
      : undefined,
    historyLimit: componentConfig.historyLimit ?? 20,
    clearHistoryAfterReply: componentConfig.clearHistoryAfterReply ?? true,
    replyToMode: componentConfig.replyToMode ?? "off",
    mentionPatterns: componentConfig.mentionPatterns,
    broadcastToChannel: componentConfig.broadcastToChannel,
  };
}

function buildDiscordDmRouteConfig(
  componentConfig: DiscordComponentConfig
): DiscordConfig {
  return {
    token: componentConfig.token,
    applicationId: componentConfig.applicationId,
    dm: buildComponentDmConfig(true),
    groupPolicy: "disabled",
    historyLimit: componentConfig.historyLimit ?? 20,
    clearHistoryAfterReply: componentConfig.clearHistoryAfterReply ?? true,
    replyToMode: componentConfig.replyToMode ?? "off",
    mentionPatterns: componentConfig.mentionPatterns,
    broadcastToChannel: componentConfig.broadcastToChannel,
  };
}

function resolveMessageTarget(
  componentConfig: DiscordComponentConfig,
  agentsById: Map<string, AgentConfig>,
  data: MessageData
): ResolvedDiscordMessageTarget | null {
  if (!data.guild_id) {
    if (componentConfig.dm?.enabled === false) return null;
    if (!componentConfig.dm?.agent) return null;
    const agent = agentsById.get(componentConfig.dm.agent);
    if (!agent) return null;
    return {
      agent,
      config: buildDiscordDmRouteConfig(componentConfig),
      isMainSession: true,
      logPrefix: `[discord:${agent.id}]`,
    };
  }

  const route =
    componentConfig.channels?.[data.channel_id] ??
    (data.parent_channel_id
      ? componentConfig.channels?.[data.parent_channel_id]
      : undefined);
  if (!route) return null;

  const agent = agentsById.get(route.agent);
  if (!agent) return null;

  return {
    agent,
    config: buildDiscordRouteConfig(
      componentConfig,
      data.channel_id,
      data.guild_id,
      route.requireMention
    ),
    isMainSession: false,
    logPrefix: `[discord:${agent.id}]`,
  };
}

function resolveReactionTarget(
  componentConfig: DiscordComponentConfig,
  agentsById: Map<string, AgentConfig>,
  data: ReactionData
): ResolvedDiscordReactionTarget | null {
  if (!data.guild_id) {
    if (componentConfig.dm?.enabled === false) return null;
    if (!componentConfig.dm?.agent) return null;
    const agent = agentsById.get(componentConfig.dm.agent);
    if (!agent) return null;
    return {
      agent,
      config: buildDiscordDmRouteConfig(componentConfig),
      logPrefix: `[discord:${agent.id}]`,
    };
  }

  const route = componentConfig.channels?.[data.channel_id];
  if (!route) return null;

  const agent = agentsById.get(route.agent);
  if (!agent) return null;

  return {
    agent,
    config: buildDiscordRouteConfig(
      componentConfig,
      data.channel_id,
      data.guild_id,
      route.requireMention
    ),
    logPrefix: `[discord:${agent.id}]`,
  };
}

function resolveCommandTarget(
  componentConfig: DiscordComponentConfig,
  agentsById: Map<string, AgentConfig>,
  interaction: CommandInteraction
): { agent: AgentConfig; config: DiscordConfig } | undefined {
  const raw = interaction.rawData as { channel_id?: string; guild_id?: string };
  if (!raw.channel_id) return undefined;

  if (!raw.guild_id) {
    if (componentConfig.dm?.enabled === false || !componentConfig.dm?.agent) {
      return undefined;
    }
    const agent = agentsById.get(componentConfig.dm.agent);
    if (!agent) return undefined;
    return {
      agent,
      config: buildDiscordDmRouteConfig(componentConfig),
    };
  }

  const route = componentConfig.channels?.[raw.channel_id];
  if (!route) return undefined;
  const agent = agentsById.get(route.agent);
  if (!agent) return undefined;
  return {
    agent,
    config: buildDiscordRouteConfig(
      componentConfig,
      raw.channel_id,
      raw.guild_id,
      route.requireMention
    ),
  };
}

export async function createDiscordComponentBot(
  agents: AgentConfig[],
  componentConfig: DiscordComponentConfig
): Promise<DiscordBot | null> {
  if (!componentConfig.token) return null;

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const routedAgentIds = new Set<string>();

  for (const route of Object.values(componentConfig.channels ?? {})) {
    routedAgentIds.add(route.agent);
  }
  if (componentConfig.dm?.agent) {
    routedAgentIds.add(componentConfig.dm.agent);
  }

  if (!agents.some((agent) => routedAgentIds.has(agent.id))) {
    return null;
  }

  return createConfiguredDiscordBot({
    agentId: "discord",
    token: componentConfig.token,
    applicationId: componentConfig.applicationId,
    logPrefix: "[discord]",
    resolveMessageTarget: (data) =>
      resolveMessageTarget(componentConfig, agentsById, data),
    resolveReactionTarget: (data) =>
      resolveReactionTarget(componentConfig, agentsById, data),
    createCommands: () =>
      createSlashCommands({
        resolveAgent: (interaction) =>
          resolveCommandTarget(componentConfig, agentsById, interaction)?.agent,
        resolveDiscordConfig: (interaction) =>
          resolveCommandTarget(componentConfig, agentsById, interaction)?.config,
      }),
    acceptsAgent: (agentId) => routedAgentIds.has(agentId),
    getBroadcastChannel: () => componentConfig.broadcastToChannel,
  });
}
