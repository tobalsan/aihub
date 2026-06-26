import type { TelegramBot } from "./bot.js";

const activeBots = new Map<string, TelegramBot>();

export function registerActiveBot(agentId: string, bot: TelegramBot): void {
  activeBots.set(agentId, bot);
}

export function getActiveBot(agentId: string): TelegramBot | undefined {
  return activeBots.get(agentId);
}

export function getActiveBots(): Map<string, TelegramBot> {
  return activeBots;
}

export function clearActiveBots(): void {
  activeBots.clear();
}
