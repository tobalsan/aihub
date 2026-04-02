import type {
  AgentConfig,
  ComponentsConfig,
  DiscordComponentConfig,
  GatewayConfig,
} from "./types.js";

export interface MigrationResult {
  config: GatewayConfig;
  warnings: string[];
}

function cloneAgent(agent: AgentConfig): AgentConfig {
  return JSON.parse(JSON.stringify(agent)) as AgentConfig;
}

export function migrateConfigV1toV2(v1: GatewayConfig): MigrationResult {
  const warnings: string[] = [];
  const agents = v1.agents.map((agent) => cloneAgent(agent));
  const components: NonNullable<ComponentsConfig> = {
    ...v1.components,
  };

  const discordAgents = agents.filter((agent) => agent.discord?.token);
  if (discordAgents.length > 0) {
    const [firstDiscord] = discordAgents;
    const token = firstDiscord.discord?.token ?? "";
    const applicationId = firstDiscord.discord?.applicationId;
    const channels: NonNullable<DiscordComponentConfig["channels"]> = {};

    for (const agent of discordAgents) {
      const discord = agent.discord;
      if (!discord) continue;
      if (discord.token !== token) {
        warnings.push(
          `Multiple Discord tokens found in v1 config; using token from agent "${firstDiscord.id}"`
        );
      }
      if (discord.channelId) {
        channels[discord.channelId] = { agent: agent.id };
      }
    }

    components.discord = {
      enabled: true,
      token,
      applicationId,
      channels: Object.keys(channels).length > 0 ? channels : undefined,
      dm: firstDiscord.discord?.dm
        ? { enabled: true, agent: firstDiscord.id }
        : undefined,
      historyLimit: firstDiscord.discord?.historyLimit,
      replyToMode: firstDiscord.discord?.replyToMode,
      guilds: firstDiscord.discord?.guilds,
      groupPolicy: firstDiscord.discord?.groupPolicy,
      mentionPatterns: firstDiscord.discord?.mentionPatterns,
      broadcastToChannel: firstDiscord.discord?.broadcastToChannel,
      clearHistoryAfterReply: firstDiscord.discord?.clearHistoryAfterReply,
    };
  }

  if (agents.some((agent) => agent.heartbeat)) {
    components.heartbeat = { enabled: true };
    components.scheduler ??= {
      enabled: v1.scheduler?.enabled ?? true,
      tickSeconds: v1.scheduler?.tickSeconds ?? 60,
    };
  }

  if (agents.some((agent) => agent.amsg?.enabled !== false)) {
    components.amsg = { enabled: true };
  }

  if (v1.scheduler) {
    components.scheduler = {
      enabled: v1.scheduler.enabled,
      tickSeconds: v1.scheduler.tickSeconds,
    };
  }

  if (v1.projects) {
    components.projects = {
      enabled: true,
      root: v1.projects.root,
    };
  }

  if (agents.length > 0) {
    components.conversations ??= { enabled: true };
  }

  return {
    config: {
      ...v1,
      version: 2,
      agents,
      components,
    },
    warnings,
  };
}
