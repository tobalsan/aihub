import type { LangfuseComponentConfig } from "@aihub/shared";
import type { agentEventBus as defaultAgentEventBus } from "../../agents/events.js";

type AgentEventBus = typeof defaultAgentEventBus;

export class LangfuseTracer {
  private unsubscribe?: () => void;

  async start(
    _config: LangfuseComponentConfig,
    agentEventBus: AgentEventBus
  ): Promise<void> {
    this.unsubscribe = agentEventBus.onStreamEvent(() => {});
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
