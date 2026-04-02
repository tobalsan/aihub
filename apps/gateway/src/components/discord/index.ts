import {
  DiscordComponentConfigSchema,
  type Component,
  type DiscordComponentConfig,
} from "@aihub/shared";
import { startDiscordBots, stopDiscordBots } from "../../discord/index.js";

const discordComponent: Component = {
  id: "discord",
  displayName: "Discord",
  dependencies: [],
  requiredSecrets: [],
  routePrefixes: [],
  validateConfig(raw) {
    const result = DiscordComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start(ctx) {
    const rawConfig = ctx.getConfig().components?.discord;
    const config = DiscordComponentConfigSchema.parse(
      rawConfig
    ) as DiscordComponentConfig;

    await startDiscordBots({
      agents: ctx.getAgents(),
      componentConfig: {
        ...config,
      },
    });
  },
  async stop() {
    await stopDiscordBots();
  },
  capabilities() {
    return ["discord"];
  },
};

export { discordComponent };
