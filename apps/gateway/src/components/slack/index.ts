import {
  SlackComponentConfigSchema,
  type Component,
} from "@aihub/shared";
import {
  startSlackBots,
  stopSlackBots,
  createSlackAgentBot,
} from "../../slack/index.js";

const slackComponent: Component = {
  id: "slack",
  displayName: "Slack",
  dependencies: [],
  requiredSecrets: [],
  routePrefixes: [],
  validateConfig(raw) {
    // Per-agent sentinel or no component config — always valid
    if (
      !raw ||
      (typeof raw === "object" &&
        ("_perAgent" in (raw as object) ||
          "_perAgentFallback" in (raw as object)))
    ) {
      return { valid: true, errors: [] };
    }
    const result = SlackComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start(ctx) {
    const rawConfig = ctx.getConfig().components?.slack;

    // Start shared component bot (if components.slack has valid token/appToken)
    if (rawConfig) {
      const parsed = SlackComponentConfigSchema.safeParse(rawConfig);
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

export { slackComponent };
