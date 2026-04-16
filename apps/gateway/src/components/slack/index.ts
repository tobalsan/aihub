import {
  SlackComponentConfigSchema,
  type Component,
  type SlackComponentConfig,
} from "@aihub/shared";
import { startSlackBots, stopSlackBots } from "../../slack/index.js";

const slackComponent: Component = {
  id: "slack",
  displayName: "Slack",
  dependencies: [],
  requiredSecrets: [],
  routePrefixes: [],
  validateConfig(raw) {
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
    const config = SlackComponentConfigSchema.parse(
      rawConfig
    ) as SlackComponentConfig;

    await startSlackBots({
      agents: ctx.getAgents(),
      componentConfig: {
        ...config,
      },
    });
  },
  async stop() {
    await stopSlackBots();
  },
  capabilities() {
    return ["slack"];
  },
};

export { slackComponent };
