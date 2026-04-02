import type { AgentConfig, DiscordComponentConfig } from "@aihub/shared";
import { getActiveAgents } from "../config/index.js";
import {
  createDiscordBot,
  createDiscordComponentBot,
  type DiscordBot,
} from "./bot.js";

const activeBots = new Map<string, DiscordBot>();

type StartDiscordBotsOptions = {
  agents: AgentConfig[];
  componentConfig: DiscordComponentConfig;
};

export async function startDiscordBots(options?: StartDiscordBotsOptions) {
  if (options) {
    const bot = await createDiscordComponentBot(
      options.agents,
      options.componentConfig
    );
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

  const agents = getActiveAgents();

  for (const agent of agents) {
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

export async function stopDiscordBots() {
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

export { createDiscordBot, type DiscordBot } from "./bot.js";
