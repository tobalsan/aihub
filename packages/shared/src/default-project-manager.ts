import type { GatewayConfig } from "./types.js";

const warnedInvalidIds = new Set<string>();

export function resolveDefaultProjectManager(
  config: GatewayConfig,
  warn: (message: string) => void = console.warn
): string | null {
  const configured = config.defaultProjectManager;
  if (configured) {
    if (config.agents.some((agent) => agent.id === configured)) {
      return configured;
    }

    if (!warnedInvalidIds.has(configured)) {
      warnedInvalidIds.add(configured);
      warn(
        `[config] defaultProjectManager "${configured}" does not match any configured agent; falling back to the first agent.`
      );
    }
  }

  return config.agents[0]?.id ?? null;
}

export function resetDefaultProjectManagerWarningsForTests(): void {
  warnedInvalidIds.clear();
}
