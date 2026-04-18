import type {
  AgentConfig,
  ExtensionsConfig,
  DiscordExtensionConfig,
  GatewayConfig,
} from "./types.js";

export interface MigrationResult {
  config: GatewayConfig;
  warnings: string[];
}

function cloneAgent(agent: AgentConfig): AgentConfig {
  return JSON.parse(JSON.stringify(agent)) as AgentConfig;
}

type LegacyGatewayConfig = GatewayConfig & {
  components?: ExtensionsConfig;
  scheduler?: {
    enabled?: boolean;
    tickSeconds?: number;
  };
};

export function migrateConfigV1toV2(v1: GatewayConfig): MigrationResult {
  const legacy = v1 as LegacyGatewayConfig;
  const warnings: string[] = [];
  const agents = legacy.agents.map((agent) => cloneAgent(agent));
  const extensions: NonNullable<ExtensionsConfig> = {
    ...legacy.components,
  };

  const discordAgents = agents.filter((agent) => agent.discord?.token);
  if (discordAgents.length > 0) {
    const [firstDiscord] = discordAgents;
    const token = firstDiscord.discord?.token ?? "";
    const applicationId = firstDiscord.discord?.applicationId;
    const channels: NonNullable<DiscordExtensionConfig["channels"]> = {};

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

    extensions.discord = {
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
    extensions.heartbeat = { enabled: true };
    extensions.scheduler ??= {
      enabled: legacy.scheduler?.enabled ?? true,
      tickSeconds: legacy.scheduler?.tickSeconds ?? 60,
    };
  }

  if (legacy.scheduler) {
    extensions.scheduler = {
      enabled: legacy.scheduler.enabled,
      tickSeconds: legacy.scheduler.tickSeconds,
    };
  }

  if (v1.projects) {
    extensions.projects = {
      enabled: true,
      root: v1.projects.root,
    };
  }

  return {
    config: {
      ...v1,
      version: 2,
      agents,
      extensions,
    },
    warnings,
  };
}
