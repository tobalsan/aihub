import { EventEmitter } from "node:events";
import type { StreamEvent } from "@aihub/shared";
import type { HistoryEvent } from "../sdk/types.js";

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

export type AgentHistoryEvent = HistoryEvent & {
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
  private recentEvents: Array<{
    type: string;
    data: unknown;
    timestamp: number;
  }> = [];
  private maxRecentEvents = 50;

  recordEvent(type: string, data: unknown) {
    this.recentEvents.push({ type, data, timestamp: Date.now() });
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }
  }

  getRecentEvents() {
    return [...this.recentEvents];
  }

  emitStreamEvent(event: AgentStreamEvent) {
    this.emit("stream", event);
  }

  onStreamEvent(handler: (event: AgentStreamEvent) => void) {
    this.on("stream", handler);
    return () => this.off("stream", handler);
  }

  emitHistoryEvent(event: AgentHistoryEvent) {
    this.emit("history", event);
  }

  onHistoryEvent(handler: (event: AgentHistoryEvent) => void) {
    this.on("history", handler);
    return () => this.off("history", handler);
  }

  emitStatusChange(event: AgentStatusChangeEvent) {
    this.recordEvent("statusChange", event);
    this.emit("statusChange", event);
  }

  onStatusChange(handler: (event: AgentStatusChangeEvent) => void) {
    this.on("statusChange", handler);
    return () => this.off("statusChange", handler);
  }

  emitFileChanged(event: ProjectFileChangedEvent) {
    this.recordEvent("fileChanged", event);
    this.emit("fileChanged", event);
  }

  onFileChanged(handler: (event: ProjectFileChangedEvent) => void) {
    this.on("fileChanged", handler);
    return () => this.off("fileChanged", handler);
  }

  emitAgentChanged(event: ProjectAgentChangedEvent) {
    this.recordEvent("agentChanged", event);
    this.emit("agentChanged", event);
  }

  onAgentChanged(handler: (event: ProjectAgentChangedEvent) => void) {
    this.on("agentChanged", handler);
    return () => this.off("agentChanged", handler);
  }
}

export const agentEventBus = new AgentEventBus();
