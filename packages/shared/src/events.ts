// Event payload types shared between gateway and extensions.
// Event bus runtime stays in gateway.

import type { StreamEvent, HistoryEvent, AgentTraceContext } from "./types.js";

export type RunSource =
  | "web"
  | "discord"
  | "slack"
  | "scheduler"
  | "cli"
  | "heartbeat"
  | "webhook";

export type AgentStreamEvent = StreamEvent & {
  agentId: string;
  sessionId: string;
  sessionKey?: string;
  source?: RunSource;
  trace?: AgentTraceContext;
};

export type AgentHistoryEvent = HistoryEvent & {
  agentId: string;
  sessionId: string;
  sessionKey?: string;
  source?: RunSource;
  trace?: AgentTraceContext;
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

export type SubagentChangedEvent = {
  type: "subagent_changed";
  runId: string;
  parent?: { type: string; id: string };
  status: "starting" | "running" | "done" | "error" | "interrupted";
};
