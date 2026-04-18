import {
  DiscordExtensionConfigSchema,
  type Extension,
  type DiscordExtensionConfig,
} from "@aihub/shared";
import { startDiscordBots, stopDiscordBots } from "../../discord/index.js";

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
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start(ctx) {
    const rawConfig = ctx.getConfig().extensions?.discord;
    const config = DiscordExtensionConfigSchema.parse(
      rawConfig
    ) as DiscordExtensionConfig;

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

export { discordExtension };
