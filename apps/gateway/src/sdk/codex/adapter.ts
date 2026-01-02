import fs from "node:fs/promises";
import path from "node:path";
import type { AgentConfig } from "@aihub/shared";
import type { SdkAdapter, SdkRunParams, SdkRunResult } from "../types.js";
import type { Codex as CodexClient, CodexEvent, CodexItem, Thread } from "./types.js";
import { CONFIG_DIR } from "../../config/index.js";

const THREADS_DIR = path.join(CONFIG_DIR, "codex-threads");

async function getThreadId(agentId: string, sessionId: string): Promise<string | null> {
  const file = path.join(THREADS_DIR, `${agentId}-${sessionId}.txt`);
  try {
    return (await fs.readFile(file, "utf-8")).trim();
  } catch {
    return null;
  }
}

async function saveThreadId(agentId: string, sessionId: string, threadId: string): Promise<void> {
  await fs.mkdir(THREADS_DIR, { recursive: true });
  await fs.writeFile(path.join(THREADS_DIR, `${agentId}-${sessionId}.txt`), threadId);
}

export const codexAdapter: SdkAdapter = {
  id: "codex",
  displayName: "Codex Agent",
  capabilities: {
    queueWhileStreaming: false, // Codex SDK doesn't support queue injection
    interrupt: false, // Limited interrupt support in CLI-backed SDK
    toolEvents: true,
    fullHistory: true,
  },

  resolveDisplayModel(agent: AgentConfig) {
    return { provider: "openai", model: agent.model.model };
  },

  async run(params: SdkRunParams): Promise<SdkRunResult> {
    // Dynamic import to avoid requiring the package if not used
    let CodexClass: new () => CodexClient;
    try {
      // @ts-expect-error - optional dependency, resolved at runtime
      const sdk = await import("@openai/codex-sdk");
      CodexClass = sdk.Codex as unknown as new () => CodexClient;
    } catch {
      throw new Error(
        "Codex SDK not installed. Run: npm install @openai/codex-sdk"
      );
    }

    let aborted = false;
    let assistantText = "";

    params.abortSignal.addEventListener("abort", () => {
      aborted = true;
    });

    // Emit user message to history
    params.onHistoryEvent({ type: "user", text: params.message, timestamp: Date.now() });

    try {
      // Create Codex client
      const codex = new CodexClass();

      // Start or resume thread based on existing session
      const existingThreadId = await getThreadId(params.agentId, params.sessionId);
      let thread: Thread;
      if (existingThreadId) {
        thread = codex.resumeThread(existingThreadId, {
          workingDirectory: params.workspaceDir,
          skipGitRepoCheck: true,
        });
      } else {
        thread = codex.startThread({
          workingDirectory: params.workspaceDir,
          skipGitRepoCheck: true,
        });
        // Save thread ID for future resume
        if (thread.id) {
          await saveThreadId(params.agentId, params.sessionId, thread.id);
        }
      }

      // Use runStreamed for real-time events
      const { events } = await thread.runStreamed(params.message);

      // Process streaming events
      for await (const rawEvent of events) {
        if (aborted) break;
        const event = rawEvent as CodexEvent;

        switch (event.type) {
          case "thread.started":
            // Thread created - emit session handle
            params.onSessionHandle?.(thread);
            break;

          case "turn.started":
            // New assistant turn starting
            break;

          case "item.started": {
            // New item starting
            const item = (event as { item: CodexItem }).item;
            if (item.type === "command_execution" || item.type === "file_change" || item.type === "mcp_tool") {
              const toolName = item.name ?? item.type;
              params.onEvent({ type: "tool_start", toolName });
              params.onHistoryEvent({
                type: "tool_call",
                id: item.id,
                name: toolName,
                args: item.input,
                timestamp: Date.now(),
              });
            } else if (item.type === "reasoning") {
              // Reasoning/thinking item
              if (item.content) {
                params.onHistoryEvent({
                  type: "assistant_thinking",
                  text: item.content,
                  timestamp: Date.now(),
                });
              }
            }
            break;
          }

          case "item.completed": {
            // Item completed
            const item = (event as { item: CodexItem }).item;
            if (item.type === "command_execution" || item.type === "file_change" || item.type === "mcp_tool") {
              const toolName = item.name ?? item.type;
              const isError = item.status === "failed";
              const content = item.output != null ? String(item.output) : "";

              params.onEvent({ type: "tool_end", toolName, isError });
              params.onHistoryEvent({
                type: "tool_result",
                id: item.id,
                name: toolName,
                content,
                isError,
                timestamp: Date.now(),
              });
            } else if (item.type === "agent_message") {
              // Agent text message
              const text = item.content ?? "";
              if (text) {
                assistantText += text;
                params.onEvent({ type: "text", data: text });
                params.onHistoryEvent({
                  type: "assistant_text",
                  text,
                  timestamp: Date.now(),
                });
              }
            }
            break;
          }

          case "turn.completed": {
            // Turn completed - emit usage meta
            const turnEvent = event as Extract<CodexEvent, { type: "turn.completed" }>;
            if (turnEvent.usage) {
              params.onHistoryEvent({
                type: "meta",
                provider: "openai",
                usage: {
                  input: turnEvent.usage.input_tokens ?? 0,
                  output: turnEvent.usage.output_tokens ?? 0,
                  totalTokens: (turnEvent.usage.input_tokens ?? 0) + (turnEvent.usage.output_tokens ?? 0),
                },
                timestamp: Date.now(),
              });
            }
            params.onHistoryEvent({ type: "turn_end", timestamp: Date.now() });
            break;
          }

          case "turn.failed":
          case "error": {
            const errorEvent = event as { error?: string };
            const errorMsg = errorEvent.error ?? "Turn failed";
            params.onEvent({ type: "error", message: errorMsg });
            params.onHistoryEvent({ type: "turn_end", timestamp: Date.now() });
            break;
          }
        }
      }
    } catch (err) {
      if (!aborted) {
        const errMessage = err instanceof Error ? err.message : String(err);
        params.onEvent({ type: "error", message: errMessage });
        throw err;
      }
    }

    return { text: assistantText, aborted };
  },

  // Codex SDK has limited abort support
  abort(_handle: unknown): void {
    // The Codex SDK doesn't expose a direct abort mechanism
    // Abort is handled via the abortSignal check in the event loop
  },
};
