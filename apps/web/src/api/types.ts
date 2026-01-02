export type Agent = {
  id: string;
  name: string;
  model: {
    provider: string;
    model: string;
  };
  workspace?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type SendMessageResponse = {
  payloads: Array<{ text?: string; mediaUrls?: string[] }>;
  meta: {
    durationMs: number;
    sessionId: string;
  };
};

// Stream event types (WebSocket protocol)
export type StreamEvent =
  | { type: "text"; data: string }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; isError?: boolean }
  | { type: "done"; meta?: { durationMs: number } }
  | { type: "error"; message: string };

// History view mode
export type HistoryViewMode = "simple" | "full";

// Simple history message (text only)
export type SimpleHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

// Alias for backward compatibility
export type HistoryMessage = SimpleHistoryMessage;

// Content block types for full history
export type ThinkingBlock = {
  type: "thinking";
  thinking: string;
};

export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolCallBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
};

export type ContentBlock = ThinkingBlock | TextBlock | ToolCallBlock;

// Model usage info
export type ModelUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    total: number;
  };
};

// Model metadata for assistant messages
export type ModelMeta = {
  api?: string;
  provider?: string;
  model?: string;
  usage?: ModelUsage;
  stopReason?: string;
};

// Full history message types
export type FullUserMessage = {
  role: "user";
  content: ContentBlock[];
  timestamp: number;
};

export type FullAssistantMessage = {
  role: "assistant";
  content: ContentBlock[];
  timestamp: number;
  meta?: ModelMeta;
};

export type FullToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  isError: boolean;
  details?: { diff?: string };
  timestamp: number;
};

export type FullHistoryMessage = FullUserMessage | FullAssistantMessage | FullToolResultMessage;

// Active tool call during streaming
export type ActiveToolCall = {
  id: string;
  toolName: string;
  status: "running" | "done" | "error";
};
