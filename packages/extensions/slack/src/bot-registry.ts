import type { SlackBot } from "./bot.js";

const activeBots = new Map<string, SlackBot>();

export function registerActiveBot(agentId: string, bot: SlackBot): void {
  activeBots.set(agentId, bot);
}

export function getActiveBot(agentId: string): SlackBot | undefined {
  return activeBots.get(agentId);
}

export function getActiveBots(): Map<string, SlackBot> {
  return activeBots;
}

export function clearActiveBots(): void {
  activeBots.clear();
}
