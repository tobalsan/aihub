import type { GatewayConfig } from "@aihub/shared";
import {
  dispatchOrchestratorTick,
  type OrchestratorAttemptTracker,
} from "./dispatcher.js";
import {
  getOrchestratorConfig,
  type OrchestratorConfig,
} from "./config.js";

export type OrchestratorDaemon = {
  stop(): Promise<void>;
};

// Tracks last spawn-attempt time per project (regardless of outcome).
// Suppresses re-dispatch within `failure_cooldown_ms` so a hard-failing
// project doesn't get hammered every tick. In-memory by design: a gateway
// restart resets the cooldown, which is desirable (restart = intentional
// retry).
function createAttemptTracker(): OrchestratorAttemptTracker {
  const lastAttemptAt = new Map<string, number>();
  return {
    record(projectId: string, atMs: number): void {
      lastAttemptAt.set(projectId, atMs);
    },
    isCoolingDown(projectId: string, nowMs: number, cooldownMs: number): boolean {
      if (cooldownMs <= 0) return false;
      const previous = lastAttemptAt.get(projectId);
      if (previous === undefined) return false;
      return nowMs - previous < cooldownMs;
    },
    clear(): void {
      lastAttemptAt.clear();
    },
  };
}

export function startOrchestratorDaemon(
  config: GatewayConfig
): OrchestratorDaemon | null {
  const orchestratorConfig = getOrchestratorConfig(config);
  if (!orchestratorConfig.enabled) return null;

  const attempts = createAttemptTracker();
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await dispatchOrchestratorTick(config, orchestratorConfig, {
        attempts,
      });
    } catch (error) {
      console.error(
        `component=orchestrator action=tick_failed error=${JSON.stringify(
          error instanceof Error ? error.message : String(error)
        )}`
      );
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, orchestratorConfig.poll_interval_ms);
  void tick();

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      attempts.clear();
    },
  };
}

export { getOrchestratorConfig, type OrchestratorConfig };
