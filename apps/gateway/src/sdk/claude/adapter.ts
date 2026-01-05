import type { AgentConfig, AgentModelConfig } from "@aihub/shared";
import type { SdkAdapter, SdkRunParams, SdkRunResult } from "../types.js";
import type { QueryFunction, SDKMessage } from "./types.js";
import { ensureBootstrapFiles } from "../../agents/workspace.js";
import { getClaudeSessionId, setClaudeSessionId } from "../../sessions/claude.js";

// Module-level lock for serializing runs that modify env vars
let claudeEnvLock: Promise<void> = Promise.resolve();

type EnvOverrides = {
  base_url?: string;
  auth_token?: string;
};

function getEnvOverrides(model: AgentModelConfig): EnvOverrides | null {
  if (!model.base_url && !model.auth_token) return null;
  return { base_url: model.base_url, auth_token: model.auth_token };
}

async function withClaudeEnv<T>(
  overrides: EnvOverrides | null,
  fn: () => Promise<T>
): Promise<T> {
  // No overrides needed - run directly without lock
  if (!overrides) {
    return fn();
  }

  // Need to set env vars - acquire lock to prevent cross-contamination
  const prevLock = claudeEnvLock;
  let releaseLock: () => void;
  claudeEnvLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  await prevLock;

  const savedEnv: Record<string, string | undefined> = {};
  try {
    // Save and set ANTHROPIC_BASE_URL
    if (overrides.base_url) {
      savedEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
      process.env.ANTHROPIC_BASE_URL = overrides.base_url;
    }
    // Save and set ANTHROPIC_AUTH_TOKEN
    if (overrides.auth_token) {
      savedEnv.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
      process.env.ANTHROPIC_AUTH_TOKEN = overrides.auth_token;
    }

    return await fn();
  } finally {
    // Restore previous env
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    releaseLock!();
  }
}

export const claudeAdapter: SdkAdapter = {
  id: "claude",
  displayName: "Claude Agent",
  capabilities: {
    queueWhileStreaming: false, // Claude Agent SDK doesn't support queue injection
    interrupt: true,
    toolEvents: true,
    fullHistory: true,
  },

  resolveDisplayModel(agent: AgentConfig) {
    return { provider: "anthropic", model: agent.model.model };
  },

  async run(params: SdkRunParams): Promise<SdkRunResult> {
    const envOverrides = getEnvOverrides(params.agent.model);

    // Ensure bootstrap files exist (CLAUDE.md, AGENTS.md, SOUL.md, etc.)
    await ensureBootstrapFiles(params.workspaceDir);

    // Handle empty message (e.g., after /new or /reset stripped the trigger)
    // Claude SDK doesn't accept empty prompts, so return early
    if (!params.message.trim()) {
      return { text: "", aborted: false };
    }

    return withClaudeEnv(envOverrides, async () => {
      // Dynamic import to avoid requiring the package if not used
      let query: QueryFunction;
      try {
        const sdk = await import("@anthropic-ai/claude-agent-sdk");
        query = sdk.query as QueryFunction;
      } catch {
        throw new Error(
          "Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk"
        );
      }

      let aborted = false;
      let assistantText = "";
      const toolIdToName = new Map<string, string>();
      let sentTurnEnd = false;

      // Create abort controller
      const abortController = new AbortController();
      params.abortSignal.addEventListener("abort", () => {
        aborted = true;
        abortController.abort();
      });

      // Emit user message to history
      params.onHistoryEvent({ type: "user", text: params.message, timestamp: Date.now() });

      // Look up existing Claude session for resumption (only if model matches)
      const requestedModel = params.agent.model.model;
      const existingClaudeSessionId = getClaudeSessionId(params.agentId, params.sessionId, requestedModel);

      try {
        // Query the Claude Agent SDK
        const conversation = query({
          prompt: params.message,
          options: {
            cwd: params.workspaceDir,
            abortController,
            // Use Claude Code's built-in tools
            tools: { type: "preset", preset: "claude_code" },
            // Use Claude Code's system prompt
            systemPrompt: { type: "preset", preset: "claude_code" },
            // Load project settings (CLAUDE.md, etc.)
            settingSources: ["project"],
            // Stream partial messages for real-time updates
            includePartialMessages: true,
            // Use model from agent config
            model: params.agent.model.model,
            // Resume existing session if available
            resume: existingClaudeSessionId,
            // Bypass all permission prompts - tools run automatically
            permissionMode: "bypassPermissions",
          },
        });

        // Process streaming messages
        for await (const rawMessage of conversation) {
          if (aborted) break;
          const message = rawMessage as SDKMessage;

          // Handle partial streaming messages
          if (message.type === "stream_event") {
            const event = message.event;
            // Handle content block delta for text streaming
            if (event.type === "content_block_delta") {
              const delta = event.delta;
              if (delta?.type === "text_delta" && delta.text) {
                assistantText += delta.text;
                params.onEvent({ type: "text", data: delta.text });
                params.onHistoryEvent({
                  type: "assistant_text",
                  text: delta.text,
                  timestamp: Date.now(),
                });
              }
            }
          }

          // Handle complete assistant messages
          if (message.type === "assistant") {
            const apiMessage = message.message;
            // Process content blocks
            if (apiMessage.content) {
              for (const block of apiMessage.content) {
                if (block.type === "tool_use" && block.id && block.name) {
                  toolIdToName.set(block.id, block.name);
                  params.onEvent({ type: "tool_start", toolName: block.name });
                  params.onEvent({ type: "tool_call", id: block.id, name: block.name, arguments: block.input });
                  params.onHistoryEvent({
                    type: "tool_call",
                    id: block.id,
                    name: block.name,
                    args: block.input,
                    timestamp: Date.now(),
                  });
                } else if (block.type === "thinking" && block.thinking) {
                  params.onEvent({ type: "thinking", data: block.thinking });
                  params.onHistoryEvent({
                    type: "assistant_thinking",
                    text: block.thinking,
                    timestamp: Date.now(),
                  });
                }
              }
            }

            // Emit meta info
            if (apiMessage.usage) {
              params.onHistoryEvent({
                type: "meta",
                provider: "anthropic",
                model: apiMessage.model,
                usage: {
                  input: apiMessage.usage.input_tokens,
                  output: apiMessage.usage.output_tokens,
                  cacheRead: apiMessage.usage.cache_read_input_tokens ?? undefined,
                  cacheWrite: apiMessage.usage.cache_creation_input_tokens ?? undefined,
                  totalTokens:
                    apiMessage.usage.input_tokens + apiMessage.usage.output_tokens,
                },
                stopReason: apiMessage.stop_reason ?? undefined,
                timestamp: Date.now(),
              });
            }
          }

          // Handle user messages (tool results)
          if (message.type === "user") {
            const apiMessage = message.message;
            if (apiMessage.content) {
              for (const block of apiMessage.content) {
                if (block.type === "tool_result") {
                  const toolName = toolIdToName.get(block.tool_use_id) ?? block.tool_use_id;
                  const content =
                    typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content);
                  params.onEvent({
                    type: "tool_end",
                    toolName,
                    isError: block.is_error ?? false,
                  });
                  params.onHistoryEvent({
                    type: "tool_result",
                    id: block.tool_use_id,
                    name: toolName,
                    content: content ?? "",
                    isError: block.is_error ?? false,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          }

          // Handle final result
          if (message.type === "result") {
            if (message.subtype === "success") {
              assistantText = message.result || assistantText;
            }
          }

          // Handle system init message to capture session_id
          if (message.type === "system" && message.subtype === "init" && message.session_id) {
            await setClaudeSessionId(params.agentId, params.sessionId, message.session_id, requestedModel);
          }
        }
      } catch (err) {
        if (!aborted) {
          const errMessage = err instanceof Error ? err.message : String(err);
          params.onEvent({ type: "error", message: errMessage });
          throw err;
        }
      }

      if (!sentTurnEnd) {
        params.onHistoryEvent({ type: "turn_end", timestamp: Date.now() });
        sentTurnEnd = true;
      }

      return { text: assistantText, aborted };
    });
  },

  abort(handle: unknown): void {
    // The abort is handled via the abortController passed to query()
    // The handle is not used for Claude SDK
    void handle;
  },
};
