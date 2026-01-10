import { getActiveAgents } from "../config/index.js";
import { createDiscordBot, type DiscordBot } from "./bot.js";

const activeBots = new Map<string, DiscordBot>();

export async function startDiscordBots() {
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
