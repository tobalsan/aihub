import {
  SlackExtensionConfigSchema,
  type AgentConfig,
  type Extension,
  type ExtensionContext,
  type SlackComponentConfig,
} from "@aihub/shared";
import {
  createSlackAgentBot,
  createSlackBot,
  type SlackBot,
} from "./bot.js";
import { clearSlackContext, setSlackContext } from "./context.js";

const activeBots = new Map<string, SlackBot>();

type StartSlackBotsOptions = {
  agents: AgentConfig[];
  componentConfig: SlackComponentConfig;
};

export async function startSlackBots(
  ctx: ExtensionContext,
  options?: StartSlackBotsOptions
): Promise<void> {
  setSlackContext(ctx);

  if (options) {
    const bot = createSlackBot(options.agents, options.componentConfig);
    if (!bot) return;

    try {
      await bot.start();
      activeBots.set(bot.agentId, bot);
      console.log("[slack] Started component bot");
    } catch (err) {
      console.error("[slack] Failed to start component bot:", err);
    }
    return;
  }

  const agentBots = ctx
    .getAgents()
    .filter((agent) => agent.slack?.token && agent.slack?.appToken)
    .map((agent) => ({ agent, bot: createSlackAgentBot(agent) }))
    .filter((entry): entry is { agent: AgentConfig; bot: SlackBot } => !!entry.bot);

  await Promise.all(
    agentBots.map(async ({ agent, bot }) => {
      try {
        await bot.start();
        activeBots.set(agent.id, bot);
        console.log(`[slack] Started bot for agent: ${agent.id}`);
      } catch (err) {
        console.error(`[slack] Failed to start bot for agent ${agent.id}:`, err);
      }
    })
  );
}

export async function stopSlackBots(): Promise<void> {
  for (const [agentId, bot] of activeBots) {
    try {
      await bot.stop();
      console.log(`[slack] Stopped bot: ${agentId}`);
    } catch (err) {
      console.error(`[slack] Failed to stop bot ${agentId}:`, err);
    }
  }
  activeBots.clear();
}

export function getActiveBot(agentId: string): SlackBot | undefined {
  return activeBots.get(agentId);
}

const slackExtension: Extension = {
  id: "slack",
  displayName: "Slack",
  description: "Slack integration for channel and DM routing",
  dependencies: [],
  configSchema: SlackExtensionConfigSchema,
  routePrefixes: [],
  validateConfig(raw) {
    if (
      !raw ||
      (typeof raw === "object" &&
        (Object.keys(raw as object).length === 0 ||
          "_perAgent" in (raw as object) ||
          "_perAgentFallback" in (raw as object)))
    ) {
      return { valid: true, errors: [] };
    }
    const result = SlackExtensionConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start(ctx) {
    const rawConfig = ctx.getConfig().extensions?.slack;

    if (rawConfig) {
      const parsed = SlackExtensionConfigSchema.safeParse(rawConfig);
      if (parsed.success) {
        await startSlackBots(ctx, {
          agents: ctx.getAgents(),
          componentConfig: { ...parsed.data },
        });
      }
    }

    await startSlackBots(ctx);
  },
  async stop() {
    await stopSlackBots();
    clearSlackContext();
  },
  capabilities() {
    return ["slack"];
  },
};

export { slackExtension, createSlackAgentBot, createSlackBot, type SlackBot };
