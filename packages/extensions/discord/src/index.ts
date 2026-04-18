import {
  DiscordExtensionConfigSchema,
  type DiscordExtensionConfig,
  type Extension,
  type ExtensionContext,
  type DiscordComponentConfig,
} from "@aihub/shared";
import {
  createDiscordBot,
  createDiscordComponentBot,
  type DiscordBot,
} from "./bot.js";
import { clearDiscordContext, setDiscordContext } from "./context.js";

const activeBots = new Map<string, DiscordBot>();

export async function startDiscordBots(
  ctx: ExtensionContext,
  componentConfig?: DiscordComponentConfig
): Promise<void> {
  setDiscordContext(ctx);

  if (componentConfig) {
    const bot = await createDiscordComponentBot(ctx.getAgents(), componentConfig);
    if (!bot) return;

    try {
      await bot.start();
      activeBots.set(bot.agentId, bot);
      console.log("[discord] Started component bot");
    } catch (err) {
      console.error("[discord] Failed to start component bot:", err);
    }
    return;
  }

  const agents = ctx.getAgents();

  for (const agent of agents) {
    if (!ctx.isAgentActive(agent.id)) continue;
    if (!agent.discord?.token) continue;

    const bot = await createDiscordBot(agent);
    if (!bot) continue;

    try {
      await bot.start();
      activeBots.set(agent.id, bot);
      console.log(`[discord] Started bot for agent: ${agent.id}`);
    } catch (err) {
      console.error(`[discord] Failed to start bot for agent ${agent.id}:`, err);
    }
  }
}

export async function stopDiscordBots(): Promise<void> {
  for (const [agentId, bot] of activeBots) {
    try {
      await bot.stop();
      console.log(`[discord] Stopped bot for agent: ${agentId}`);
    } catch (err) {
      console.error(`[discord] Failed to stop bot for agent ${agentId}:`, err);
    }
  }
  activeBots.clear();
}

export function getActiveBot(agentId: string): DiscordBot | undefined {
  return activeBots.get(agentId);
}

const discordExtension: Extension = {
  id: "discord",
  displayName: "Discord",
  description: "Discord integration for channel and DM routing",
  dependencies: [],
  configSchema: DiscordExtensionConfigSchema,
  routePrefixes: [],
  validateConfig(raw) {
    const result = DiscordExtensionConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start(ctx) {
    const rawConfig = ctx.getConfig().extensions?.discord;
    const config = DiscordExtensionConfigSchema.parse(
      rawConfig
    ) as DiscordExtensionConfig;

    await startDiscordBots(ctx, { ...config });
  },
  async stop() {
    await stopDiscordBots();
    clearDiscordContext();
  },
  capabilities() {
    return ["discord"];
  },
};

export { discordExtension, createDiscordBot, type DiscordBot };
