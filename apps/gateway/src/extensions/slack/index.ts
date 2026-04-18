import {
  SlackExtensionConfigSchema,
  type Extension,
} from "@aihub/shared";
import {
  startSlackBots,
  stopSlackBots,
  createSlackAgentBot,
} from "../../slack/index.js";

const slackExtension: Extension = {
  id: "slack",
  displayName: "Slack",
  description: "Slack integration for channel and DM routing",
  dependencies: [],
  configSchema: SlackExtensionConfigSchema,
  routePrefixes: [],
  validateConfig(raw) {
    // Per-agent sentinel or no extension config — always valid
    if (
      !raw ||
      (typeof raw === "object" &&
        ("_perAgent" in (raw as object) ||
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

    // Start shared extension bot (if extensions.slack has valid token/appToken)
    if (rawConfig) {
      const parsed = SlackExtensionConfigSchema.safeParse(rawConfig);
      if (parsed.success) {
        await startSlackBots({
          agents: ctx.getAgents(),
          componentConfig: { ...parsed.data },
        });
      }
    }

    // Start per-agent bots for agents with agent.slack config
    for (const agent of ctx.getAgents()) {
      if (!agent.slack?.token || !agent.slack?.appToken) continue;
      const bot = createSlackAgentBot(agent);
      if (!bot) continue;
      try {
        await bot.start();
        console.log(`[slack] Started bot for agent: ${agent.id}`);
      } catch (err) {
        console.error(
          `[slack] Failed to start bot for agent ${agent.id}:`,
          err
        );
      }
    }
  },
  async stop() {
    await stopSlackBots();
  },
  capabilities() {
    return ["slack"];
  },
};

export { slackExtension };
