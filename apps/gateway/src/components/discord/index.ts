import {
  DiscordComponentConfigSchema,
  type Component,
  type DiscordComponentConfig,
} from "@aihub/shared";
import { resolveSecretValue } from "../../config/secrets.js";
import { startDiscordBots, stopDiscordBots } from "../../discord/index.js";

const discordComponent: Component = {
  id: "discord",
  displayName: "Discord",
  dependencies: [],
  requiredSecrets: [],
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

    let token = config.token;
    if (token.startsWith("$secret:")) {
      token = await ctx.resolveSecret(token.slice("$secret:".length));
    } else {
      token = await resolveSecretValue(token, ctx.getConfig().secrets);
    }

    await startDiscordBots({
      agents: ctx.getAgents(),
      componentConfig: {
        ...config,
        token,
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
