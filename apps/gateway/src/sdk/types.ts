import type { StreamEvent, ModelUsage, AgentConfig, ThinkLevel } from "@aihub/shared";

// SDK identifiers
export type SdkId = "pi" | "claude" | "codex";

// SDK capabilities
export type SdkCapabilities = {
  queueWhileStreaming: boolean;
  interrupt: boolean;
  toolEvents: boolean;
  fullHistory: boolean;
};

// History event types (canonical transcript format)
export type HistoryEvent =
  | { type: "user"; text: string; timestamp: number }
  | { type: "assistant_text"; text: string; timestamp: number }
  | { type: "assistant_thinking"; text: string; timestamp: number }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: unknown;
      timestamp: number;
    }
  | {
      type: "tool_result";
      id: string;
      name: string;
      content: string;
      isError: boolean;
      details?: { diff?: string };
      timestamp: number;
    }
  | { type: "turn_end"; timestamp: number }
  | {
      type: "meta";
      provider?: string;
      model?: string;
      api?: string;
      usage?: ModelUsage;
      stopReason?: string;
      timestamp: number;
    };

// Run parameters passed to adapter
export type SdkRunParams = {
  agentId: string;
  sessionId: string;
  sessionKey?: string;
  message: string;
  workspaceDir: string;
  thinkLevel?: ThinkLevel;
  onEvent: (event: StreamEvent) => void;
  onHistoryEvent: (event: HistoryEvent) => void;
  onSessionHandle?: (handle: unknown) => void;
  abortSignal: AbortSignal;
};

// Run result from adapter
export type SdkRunResult = {
  text: string;
  aborted?: boolean;
};

// SDK adapter interface
export type SdkAdapter = {
  id: SdkId;
  displayName: string;
  capabilities: SdkCapabilities;
  resolveDisplayModel(agent: AgentConfig): { provider?: string; model?: string };
  run(params: SdkRunParams): Promise<SdkRunResult>;
  queueMessage?: (handle: unknown, message: string) => Promise<void>;
  abort?: (handle: unknown) => void;
};
