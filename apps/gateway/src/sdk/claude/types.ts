// Type stubs for @anthropic-ai/claude-agent-sdk
// These allow TypeScript to compile without the package installed

export type ClaudeQueryOptions = {
  cwd?: string;
  abortController?: AbortController;
  tools?: string[] | { type: "preset"; preset: "claude_code" };
  systemPrompt?: string | { type: "preset"; preset: "claude_code"; append?: string };
  settingSources?: Array<"user" | "project" | "local">;
  includePartialMessages?: boolean;
  model?: string;
  // Session resumption
  resume?: string;
  forkSession?: boolean;
  // Permission mode
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  // MCP servers + tool allowlist
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
};

export type SDKMessage =
  | {
      type: "stream_event";
      event: {
        type: string;
        delta?: { type?: string; text?: string };
      };
    }
  | {
      type: "assistant";
      message: {
        content?: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          thinking?: string;
          text?: string;
        }>;
        model?: string;
        usage?: {
          input_tokens: number;
          output_tokens: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        stop_reason?: string;
      };
    }
  | {
      type: "user";
      message: {
        content?: Array<{
          type: string;
          tool_use_id: string;
          content?: string | unknown[];
          is_error?: boolean;
        }>;
      };
    }
  | {
      type: "result";
      subtype: string;
      result?: string;
    }
  | {
      type: "system";
      subtype: string;
      session_id?: string;
    };

export type Query = AsyncGenerator<SDKMessage, void>;

export type ClaudeTextBlock = { type: "text"; text: string };
export type ClaudeImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
export type ClaudeUserContent = string | Array<ClaudeTextBlock | ClaudeImageBlock>;

export type QueryFunction = (params: {
  prompt:
    | string
    | AsyncGenerator<{ type: string; message: { role: string; content: ClaudeUserContent } }, void>;
  options?: ClaudeQueryOptions;
}) => Query;
