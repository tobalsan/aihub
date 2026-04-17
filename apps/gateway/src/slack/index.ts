import type { AgentConfig, SlackComponentConfig } from "@aihub/shared";
import { getActiveAgents } from "../config/index.js";
import {
  createSlackAgentBot,
  createSlackBot,
  type SlackBot,
} from "./bot.js";

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

  const agents = getActiveAgents();

  for (const agent of agents) {
    if (!agent.slack?.token) continue;

    const bot = createSlackAgentBot(agent);
    if (!bot) continue;

    try {
      await bot.start();
      activeBots.set(agent.id, bot);
      console.log(`[slack] Started bot for agent: ${agent.id}`);
    } catch (err) {
      console.error(`[slack] Failed to start bot for agent ${agent.id}:`, err);
    }
  }
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

export { createSlackAgentBot, createSlackBot, type SlackBot } from "./bot.js";
