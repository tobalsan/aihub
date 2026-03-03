import { EventEmitter } from "node:events";
import type { StreamEvent } from "@aihub/shared";

export type RunSource =
  | "web"
  | "discord"
  | "amsg"
  | "scheduler"
  | "cli"
  | "heartbeat";

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

export type ProjectFileChangedEvent = {
  type: "file_changed";
  projectId: string;
  file: string;
};

export type ProjectAgentChangedEvent = {
  type: "agent_changed";
  projectId: string;
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

  emitFileChanged(event: ProjectFileChangedEvent) {
    this.emit("fileChanged", event);
  }

  onFileChanged(handler: (event: ProjectFileChangedEvent) => void) {
    this.on("fileChanged", handler);
    return () => this.off("fileChanged", handler);
  }

  emitAgentChanged(event: ProjectAgentChangedEvent) {
    this.emit("agentChanged", event);
  }

  onAgentChanged(handler: (event: ProjectAgentChangedEvent) => void) {
    this.on("agentChanged", handler);
    return () => this.off("agentChanged", handler);
  }
}

export const agentEventBus = new AgentEventBus();
