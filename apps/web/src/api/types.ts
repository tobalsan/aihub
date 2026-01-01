export type Agent = {
  id: string;
  name: string;
  model: {
    provider: string;
    model: string;
  };
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
