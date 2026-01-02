import { EventEmitter } from "node:events";
import type { StreamEvent } from "@aihub/shared";

export type AgentStreamEvent = StreamEvent & {
  agentId: string;
  sessionId: string;
  sessionKey?: string;
};

class AgentEventBus extends EventEmitter {
  emitStreamEvent(event: AgentStreamEvent) {
    this.emit("stream", event);
  }

  onStreamEvent(handler: (event: AgentStreamEvent) => void) {
    this.on("stream", handler);
    return () => this.off("stream", handler);
  }
}

export const agentEventBus = new AgentEventBus();
