import type { GatewayConfig } from "@aihub/shared";
import {
  createOrchestratorAttemptTracker,
  createStallTracker,
  dispatchOrchestratorTick,
} from "./dispatcher.js";
import {
  getOrchestratorConfig,
  type OrchestratorConfig,
} from "./config.js";

export type OrchestratorDaemon = {
  stop(): Promise<void>;
};

export function startOrchestratorDaemon(
  config: GatewayConfig
): OrchestratorDaemon | null {
  const orchestratorConfig = getOrchestratorConfig(config);
  if (!orchestratorConfig.enabled) return null;

  const attempts = createOrchestratorAttemptTracker();
  const stalls = createStallTracker();
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await dispatchOrchestratorTick(config, orchestratorConfig, {
        attempts,
        stalls,
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
      stalls.clear();
    },
  };
}

export { getOrchestratorConfig, type OrchestratorConfig };
