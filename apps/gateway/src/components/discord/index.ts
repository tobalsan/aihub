import { DiscordComponentConfigSchema, type Component } from "@aihub/shared";
import { startDiscordBots, stopDiscordBots } from "../../discord/index.js";

const discordComponent: Component = {
  id: "discord",
  displayName: "Discord",
  dependencies: [],
  requiredSecrets: ["discord_bot_token"],
  validateConfig(raw) {
    const result = DiscordComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start() {
    await startDiscordBots();
  },
  async stop() {
    await stopDiscordBots();
  },
  capabilities() {
    return ["discord"];
  },
};

export { discordComponent };
