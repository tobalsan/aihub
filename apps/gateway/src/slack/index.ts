import type { AgentConfig, SlackComponentConfig } from "@aihub/shared";
import { createSlackBot, type SlackBot } from "./bot.js";

const activeBots = new Map<string, SlackBot>();

type StartSlackBotsOptions = {
  agents: AgentConfig[];
  componentConfig: SlackComponentConfig;
};

export async function startSlackBots(options?: StartSlackBotsOptions) {
  if (options) {
    const bot = createSlackBot(options.agents, options.componentConfig);
    if (!bot) return;

    try {
      await bot.start();
      activeBots.set(bot.agentId, bot);
    } catch (err) {
      console.error("[slack] Failed to start component bot:", err);
    }
    return;
  }

  console.warn("[slack] startSlackBots requires component options");
}

export async function stopSlackBots() {
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

export { createSlackBot, type SlackBot } from "./bot.js";
