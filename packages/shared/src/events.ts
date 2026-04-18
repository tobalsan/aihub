// Event payload types shared between gateway and extensions.
// Event bus runtime stays in gateway.

import type { StreamEvent, HistoryEvent } from "./types.js";

export type RunSource =
  | "web"
  | "discord"
  | "slack"
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
