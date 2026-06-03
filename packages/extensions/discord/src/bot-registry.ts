import type { DiscordBot } from "./bot.js";

const activeBots = new Map<string, DiscordBot>();

export function registerActiveBot(agentId: string, bot: DiscordBot): void {
  activeBots.set(agentId, bot);
}

export function getActiveBot(agentId: string): DiscordBot | undefined {
  return activeBots.get(agentId);
}

export function getActiveBots(): Map<string, DiscordBot> {
  return activeBots;
}

export function clearActiveBots(): void {
  activeBots.clear();
}
