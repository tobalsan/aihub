import type {
  CommandInteraction,
} from "@buape/carbon";
import type {
  AgentConfig,
  DiscordComponentConfig,
  DiscordConfig,
} from "@aihub/shared";
import { runAgent, agentEventBus } from "../agents/index.js";
import { getSessionEntry, DEFAULT_MAIN_KEY } from "../sessions/index.js";
import { onHeartbeatEvent } from "../heartbeat/index.js";
import {
  createCarbonClient,
  getGatewayPlugin,
  type CarbonClient,
  type MessageHandler,
  type ReactionHandler,
  type ReadyHandler,
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

function buildComponentDmConfig(enabled: boolean): DiscordConfig["dm"] {
  return {
    enabled,
    groupEnabled: false,
  };
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

    const recentHistory = getHistory(data.channel_id, historyLimit);
    const context = buildDiscordContext({
      channelName: channelMeta.name,
      channelTopic: channelMeta.topic,
      threadStarter: threadStarter ?? undefined,
      history: recentHistory.length > 0 ? recentHistory : undefined,
    });

    const agentResult = await runAgent({
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

    await runAgent({
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
  const { client, logPrefix, textAccumulators, acceptsAgent, getBroadcastChannel, getBotUserId } =
    params;

  const unsubscribeBroadcast = agentEventBus.onStreamEvent(async (event) => {
    if (!acceptsAgent(event.agentId)) return;
    if (event.source === "discord" || event.source === "heartbeat") return;

    const broadcastChannel = getBroadcastChannel(event.agentId);
    if (!broadcastChannel) return;

    const mainEntry = await getSessionEntry(event.agentId, DEFAULT_MAIN_KEY);
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
  });

  const unsubscribeHeartbeat = onHeartbeatEvent(async (payload) => {
    if (!acceptsAgent(payload.agentId)) return;
    if (payload.status !== "sent") return;
    if (!payload.to || !payload.alertText) return;

    if (!getBotUserId()) {
      console.warn(`${logPrefix} Heartbeat delivery skipped: bot not ready`);
      return;
    }

    const gateway = getGatewayPlugin(client);
    if (!gateway?.isConnected) {
      console.warn(`${logPrefix} Heartbeat delivery skipped: gateway not connected`);
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
  });

  return () => {
    unsubscribeBroadcast();
    unsubscribeHeartbeat();
  };
}

export async function createDiscordBot(agent: AgentConfig): Promise<DiscordBot | null> {
  if (!agent.discord?.token) return null;
  const discordConfig = agent.discord;

  const textAccumulators = new Map<string, string>();
  let cleanupBroadcasts: (() => void) | null = null;
  let botUserId: string | undefined;

  const historyLimit = discordConfig.historyLimit ?? 20;
  const clearHistoryAfterReply = discordConfig.clearHistoryAfterReply ?? true;
  const replyToMode = discordConfig.replyToMode ?? "off";

  const handleMessage: MessageHandler = async (data, client) => {
    const msgData: MessageData = {
      id: data.id,
      content: data.content ?? "",
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
    const isMainChannel = discordConfig.channelId === data.channel_id;
    await handleDiscordMessage(
      msgData,
      client,
      {
        agent,
        config: discordConfig,
        isMainSession:
          processMessage(msgData, discordConfig, botUserId).isDm || isMainChannel,
        logPrefix: `[discord:${agent.id}]`,
      },
      botUserId,
      historyLimit,
      clearHistoryAfterReply,
      replyToMode
    );
  };

  const handleReaction: ReactionHandler = async (data, client, added) => {
    await handleDiscordReaction(
      data,
      client,
      { agent, config: discordConfig, logPrefix: `[discord:${agent.id}]` },
      botUserId,
      added
    );
  };

  // Create slash commands if applicationId is present
  const hasCommands = Boolean(discordConfig.applicationId);
  const commands = hasCommands
    ? createSlashCommands({ agent, botUserId })
    : undefined;

  const handleReady: ReadyHandler = async (data, client) => {
    botUserId = data.user.id;
    console.log(`[discord:${agent.id}] Bot ready as ${data.user.username} (${botUserId})`);

    // Deploy slash commands if applicationId is configured
    if (hasCommands) {
      try {
        await client.handleDeployRequest();
        console.log(`[discord:${agent.id}] Slash commands deployed`);
      } catch (err) {
        console.error(`[discord:${agent.id}] Failed to deploy commands:`, err);
      }
    }
  };

  const clientId = await resolveDiscordClientId(
    discordConfig.token,
    discordConfig.applicationId,
    `[discord:${agent.id}]`
  );
  if (!clientId) {
    return null;
  }

  // Create client
  const client = createCarbonClient({
    token: discordConfig.token,
    clientId,
    commands,
    onMessage: handleMessage,
    onReaction: handleReaction,
    onReady: handleReady,
  });

  return {
    client,
    agentId: agent.id,
    start: async () => {
      cleanupBroadcasts = setupDiscordBroadcasts({
        client,
        logPrefix: `[discord:${agent.id}]`,
        textAccumulators,
        acceptsAgent: (agentId) => agentId === agent.id,
        getBroadcastChannel: () =>
          agent.discord?.broadcastToChannel ?? agent.discord?.channelId,
        getBotUserId: () => botUserId,
      });
    },
    stop: async () => {
      cleanupBroadcasts?.();
      cleanupBroadcasts = null;
      textAccumulators.clear();
      stopAllTyping();
      const gateway = getGatewayPlugin(client);
      if (gateway) {
        gateway.disconnect();
      }
    },
  };
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

function resolveMessageTarget(
  componentConfig: DiscordComponentConfig,
  agentsById: Map<string, AgentConfig>,
  data: MessageData
): DiscordMessageTarget | null {
  if (!data.guild_id) {
    if (componentConfig.dm?.enabled === false) return null;
    if (!componentConfig.dm?.agent) return null;
    const agent = agentsById.get(componentConfig.dm.agent);
    if (!agent) return null;
    return {
      agent,
      config: {
        token: componentConfig.token,
        applicationId: componentConfig.applicationId,
        dm: buildComponentDmConfig(true),
        groupPolicy: "disabled",
        historyLimit: componentConfig.historyLimit ?? 20,
        clearHistoryAfterReply: componentConfig.clearHistoryAfterReply ?? true,
        replyToMode: componentConfig.replyToMode ?? "off",
        mentionPatterns: componentConfig.mentionPatterns,
        broadcastToChannel: componentConfig.broadcastToChannel,
      },
      isMainSession: true,
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
    isMainSession: false,
  };
}

function resolveReactionTarget(
  componentConfig: DiscordComponentConfig,
  agentsById: Map<string, AgentConfig>,
  data: ReactionData
): DiscordReactionTarget | null {
  if (!data.guild_id) {
    if (componentConfig.dm?.enabled === false) return null;
    if (!componentConfig.dm?.agent) return null;
    const agent = agentsById.get(componentConfig.dm.agent);
    if (!agent) return null;
    return {
      agent,
      config: {
        token: componentConfig.token,
        applicationId: componentConfig.applicationId,
        dm: buildComponentDmConfig(true),
        groupPolicy: "disabled",
        historyLimit: componentConfig.historyLimit ?? 20,
        clearHistoryAfterReply: componentConfig.clearHistoryAfterReply ?? true,
        replyToMode: componentConfig.replyToMode ?? "off",
        mentionPatterns: componentConfig.mentionPatterns,
        broadcastToChannel: componentConfig.broadcastToChannel,
      },
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

  const routedAgents = agents.filter((agent) => routedAgentIds.has(agent.id));
  if (routedAgents.length === 0) return null;

  const textAccumulators = new Map<string, string>();
  let cleanupBroadcasts: (() => void) | null = null;
  let botUserId: string | undefined;

  const historyLimit = componentConfig.historyLimit ?? 20;
  const clearHistoryAfterReply = componentConfig.clearHistoryAfterReply ?? true;
  const replyToMode = componentConfig.replyToMode ?? "off";

  const handleMessage: MessageHandler = async (data, client) => {
    const msgData: MessageData = {
      id: data.id,
      content: data.content ?? "",
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

    const target = resolveMessageTarget(componentConfig, agentsById, msgData);
    if (!target) return;
    await handleDiscordMessage(
      msgData,
      client,
      { ...target, logPrefix: `[discord:${target.agent.id}]` },
      botUserId,
      historyLimit,
      clearHistoryAfterReply,
      replyToMode
    );
  };

  const handleReaction: ReactionHandler = async (data, client, added) => {
    const target = resolveReactionTarget(
      componentConfig,
      agentsById,
      data
    );
    if (!target) return;
    await handleDiscordReaction(
      data,
      client,
      { ...target, logPrefix: `[discord:${target.agent.id}]` },
      botUserId,
      added
    );
  };

  const resolveCommandTarget = (
    interaction: CommandInteraction
  ): { agent: AgentConfig; config: DiscordConfig } | undefined => {
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
          config: {
            token: componentConfig.token,
            applicationId: componentConfig.applicationId,
            dm: buildComponentDmConfig(true),
            groupPolicy: "disabled",
            historyLimit: componentConfig.historyLimit ?? 20,
            clearHistoryAfterReply: componentConfig.clearHistoryAfterReply ?? true,
            replyToMode: componentConfig.replyToMode ?? "off",
          mentionPatterns: componentConfig.mentionPatterns,
          broadcastToChannel: componentConfig.broadcastToChannel,
        },
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
  };

  const hasCommands = Boolean(componentConfig.applicationId);
  const commands = hasCommands
    ? createSlashCommands({
        resolveAgent: (interaction) => resolveCommandTarget(interaction)?.agent,
        resolveDiscordConfig: (interaction) =>
          resolveCommandTarget(interaction)?.config,
        botUserId,
      })
    : undefined;

  const handleReady: ReadyHandler = async (data, client) => {
    botUserId = data.user.id;
    console.log(`[discord] Bot ready as ${data.user.username} (${botUserId})`);

    if (hasCommands) {
      try {
        await client.handleDeployRequest();
        console.log("[discord] Slash commands deployed");
      } catch (err) {
        console.error("[discord] Failed to deploy commands:", err);
      }
    }
  };

  const clientId = await resolveDiscordClientId(
    componentConfig.token,
    componentConfig.applicationId,
    "[discord]"
  );
  if (!clientId) {
    return null;
  }

  const client = createCarbonClient({
    token: componentConfig.token,
    clientId,
    commands,
    onMessage: handleMessage,
    onReaction: handleReaction,
    onReady: handleReady,
  });

  return {
    client,
    agentId: "discord",
    start: async () => {
      cleanupBroadcasts = setupDiscordBroadcasts({
        client,
        logPrefix: "[discord]",
        textAccumulators,
        acceptsAgent: (agentId) => routedAgentIds.has(agentId),
        getBroadcastChannel: () => componentConfig.broadcastToChannel,
        getBotUserId: () => botUserId,
      });
    },
    stop: async () => {
      cleanupBroadcasts?.();
      cleanupBroadcasts = null;
      textAccumulators.clear();
      stopAllTyping();
      const gateway = getGatewayPlugin(client);
      if (gateway) {
        gateway.disconnect();
      }
    },
  };
}
