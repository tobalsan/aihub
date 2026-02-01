import { EventEmitter } from "node:events";
import type { StreamEvent } from "@aihub/shared";

export type RunSource = "web" | "discord" | "amsg" | "scheduler" | "cli" | "heartbeat";

export type AgentStreamEvent = StreamEvent & {
  agentId: string;
  sessionId: string;
  sessionKey?: string;
  source?: RunSource;
};

export type AgentStatusChangeEvent = {
  agentId: string;
  status: "streaming" | "idle";
};

class AgentEventBus extends EventEmitter {
  emitStreamEvent(event: AgentStreamEvent) {
    this.emit("stream", event);
  }

  onStreamEvent(handler: (event: AgentStreamEvent) => void) {
    this.on("stream", handler);
    return () => this.off("stream", handler);
  }

  emitStatusChange(event: AgentStatusChangeEvent) {
    this.emit("statusChange", event);
  }

  onStatusChange(handler: (event: AgentStatusChangeEvent) => void) {
    this.on("statusChange", handler);
    return () => this.off("statusChange", handler);
  }
}

export const agentEventBus = new AgentEventBus();
