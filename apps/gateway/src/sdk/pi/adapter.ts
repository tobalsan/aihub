import fs from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@mariozechner/pi-ai";
import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "@aihub/shared";
import type { SdkAdapter, SdkRunParams, SdkRunResult, HistoryEvent } from "../types.js";
import { CONFIG_DIR } from "../../config/index.js";
import {
  ensureBootstrapFiles,
  loadBootstrapFiles,
  buildBootstrapContextFiles,
} from "../../agents/workspace.js";
import {
  getSessionCreatedAt,
  formatSessionTimestamp,
} from "../../sessions/store.js";
import { renderAgentContext } from "../../discord/utils/context.js";
import { createPiSubagentTools } from "../../subagents/pi_tools.js";

const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");

async function ensureSessionsDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

const legacyFileName = (agentId: string, sessionId: string) =>
  `${agentId}-${sessionId}.jsonl`;

const timestampedFileName = (timestamp: number, agentId: string, sessionId: string) =>
  `${formatSessionTimestamp(timestamp)}_${agentId}-${sessionId}.jsonl`;

/**
 * Find existing timestamped file by scanning directory for pattern *_{agentId}-{sessionId}.jsonl
 * Returns the most recent (lexicographically last) if multiple exist
 */
async function findTimestampedFile(dir: string, agentId: string, sessionId: string): Promise<string | null> {
  const suffix = `_${agentId}-${sessionId}.jsonl`;
  try {
    const files = await fs.readdir(dir);
    const matches = files.filter((f) => f.endsWith(suffix)).sort();
    const latest = matches.at(-1);
    return latest ? path.join(dir, latest) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve session file path with timestamp prefix support.
 * - For existing files: checks known timestamped path, then scans for any timestamped file, then legacy
 * - For new files: always creates timestamped filename (uses createdAt or defaults to now)
 */
async function resolveSessionFile(agentId: string, sessionId: string): Promise<string> {
  await ensureSessionsDir();
  const createdAt = getSessionCreatedAt(sessionId);

  // Try exact timestamped file first (if we have createdAt)
  if (createdAt) {
    const timestampedPath = path.join(SESSIONS_DIR, timestampedFileName(createdAt, agentId, sessionId));
    try {
      await fs.access(timestampedPath);
      return timestampedPath;
    } catch {
      // Exact timestamped file doesn't exist
    }
  }

  // Scan for any existing timestamped file (handles missing createdAt in sessions.json)
  const existingTimestamped = await findTimestampedFile(SESSIONS_DIR, agentId, sessionId);
  if (existingTimestamped) {
    return existingTimestamped;
  }

  // Try legacy file (backwards compat)
  const legacyPath = path.join(SESSIONS_DIR, legacyFileName(agentId, sessionId));
  try {
    await fs.access(legacyPath);
    return legacyPath;
  } catch {
    // Neither exists, create new timestamped file
  }

  // New file: always use timestamped format (use createdAt or default to now)
  const timestamp = createdAt ?? Date.now();
  return path.join(SESSIONS_DIR, timestampedFileName(timestamp, agentId, sessionId));
}

function extractAssistantText(msg: AssistantMessage): string {
  if (!msg.content) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

export const piAdapter: SdkAdapter = {
  id: "pi",
  displayName: "Pi Agent",
  capabilities: {
    queueWhileStreaming: true,
    interrupt: true,
    toolEvents: true,
    fullHistory: true,
  },

  resolveDisplayModel(agent: AgentConfig) {
    return { provider: agent.model.provider, model: agent.model.model };
  },

  async run(params: SdkRunParams): Promise<SdkRunResult> {
    const sessionFile = await resolveSessionFile(params.agentId, params.sessionId);

    // Ensure bootstrap files exist
    await ensureBootstrapFiles(params.workspaceDir);

    // Dynamically import pi-coding-agent
    const {
      createAgentSession,
      SessionManager,
      SettingsManager,
      discoverAuthStorage,
      discoverModels,
      discoverSkills,
      buildSystemPrompt,
      createCodingTools,
    } = await import("@mariozechner/pi-coding-agent");
    const { getEnvApiKey } = await import("@mariozechner/pi-ai");

    // Resolve model
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    // Get agent config to resolve model
    const { getAgent } = await import("../../config/index.js");
    const agent = getAgent(params.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${params.agentId}`);
    }

    const authStorage = discoverAuthStorage(CONFIG_DIR);
    const modelRegistry = discoverModels(authStorage, CONFIG_DIR);
    if (!agent.model.provider) {
      throw new Error(`Pi SDK requires model.provider to be set for agent: ${agent.id}`);
    }
    const model = modelRegistry.find(agent.model.provider, agent.model.model);

    if (!model) {
      throw new Error(`Model not found: ${agent.model.provider}/${agent.model.model}`);
    }

    // Get API key based on auth.mode
    const authMode = agent.auth?.mode;
    let apiKey: string | null = null;

    if (authMode === "oauth") {
      // OAuth mode: require OAuth credentials
      const cred = authStorage.get(model.provider);
      if (!cred || cred.type !== "oauth") {
        throw new Error(
          `No OAuth credentials for provider: ${model.provider}. Run 'aihub auth login ${model.provider}' first.`
        );
      }
      apiKey = (await authStorage.getApiKey(model.provider)) ?? null;
    } else if (authMode === "api_key") {
      // API key mode: only use API key credentials or env vars, skip OAuth
      const cred = authStorage.get(model.provider);
      if (cred?.type === "api_key") {
        apiKey = cred.key;
      } else {
        apiKey = getEnvApiKey(model.provider) ?? null;
      }
      if (!apiKey) {
        // Format env var name: github-copilot -> GITHUB_COPILOT_API_KEY
        const envVar = `${model.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
        throw new Error(`No API key for provider: ${model.provider}. Set ${envVar} env var.`);
      }
    } else {
      // Default/proxy: Pi SDK's getApiKey handles OAuth, API keys, and env vars
      // Priority: runtime override > api_key > oauth (refreshed) > env > fallback (models.json)
      apiKey = (await authStorage.getApiKey(model.provider)) ?? null;
    }

    if (!apiKey) {
      throw new Error(`No API key for provider: ${model.provider}`);
    }
    authStorage.setRuntimeApiKey(model.provider, apiKey);

    // Discover skills
    const { skills } = discoverSkills(params.workspaceDir);

    // Load bootstrap context files
    const bootstrapFiles = await loadBootstrapFiles(params.workspaceDir);
    const contextFiles = buildBootstrapContextFiles(bootstrapFiles);

    // Create tools
    const tools = createCodingTools(params.workspaceDir).concat(createPiSubagentTools());
    const subagentToolPrompt = [
      "Additional tools:",
      "- subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch?, resume? }",
      "- subagent.status { projectId, slug }",
      "- subagent.logs { projectId, slug, since? }",
      "- subagent.interrupt { projectId, slug }",
    ].join("\n");

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      cwd: params.workspaceDir,
      contextFiles,
      skills,
      appendPrompt: subagentToolPrompt,
    });

    const sessionManager = SessionManager.open(sessionFile, CONFIG_DIR);
    const settingsManager = SettingsManager.create(params.workspaceDir, CONFIG_DIR);

    const { session: agentSession } = await createAgentSession({
      cwd: params.workspaceDir,
      agentDir: CONFIG_DIR,
      authStorage,
      modelRegistry,
      model,
      ...(params.thinkLevel && { thinkingLevel: params.thinkLevel }),
      systemPrompt,
      tools,
      sessionManager,
      settingsManager,
      skills,
      contextFiles,
    });

    // Emit session handle for queue injection
    params.onSessionHandle?.(agentSession);

    let aborted = false;

    // Handle abort
    params.abortSignal.addEventListener("abort", () => {
      aborted = true;
      agentSession.abort();
    });

    // Render context preamble and emit system_context event if present
    let contextPreamble = "";
    if (params.context) {
      contextPreamble = renderAgentContext(params.context);
      if (contextPreamble) {
        params.onHistoryEvent({
          type: "system_context",
          context: params.context,
          rendered: contextPreamble,
          timestamp: Date.now(),
        });
      }
    }

    const images: ImageContent[] | undefined = params.attachments?.map((attachment) => ({
      type: "image",
      data: attachment.data,
      mimeType: attachment.mediaType,
    }));

    // Build message with context preamble (if any)
    const messageToSend = contextPreamble
      ? `${contextPreamble}\n\n${params.message}`
      : params.message;

    // Emit user message to history (without context preamble)
    params.onHistoryEvent({ type: "user", text: params.message, timestamp: Date.now() });

    // Subscribe to streaming events

    const unsubscribe = agentSession.subscribe((evt) => {
      if (evt.type === "message_update") {
        const msg = (evt as { message?: AgentMessage }).message;
        if (msg?.role === "assistant") {
          const assistantEvent = (evt as { assistantMessageEvent?: unknown })
            .assistantMessageEvent as Record<string, unknown> | undefined;
          const evtType = assistantEvent?.type as string | undefined;

          if (evtType === "text_delta") {
            const chunk = assistantEvent?.delta as string;
            if (chunk) {
              params.onEvent({ type: "text", data: chunk });
              params.onHistoryEvent({
                type: "assistant_text",
                text: chunk,
                timestamp: Date.now(),
              });
            }
          } else if (evtType === "thinking_delta") {
            const chunk = assistantEvent?.delta as string;
            if (chunk) {
              params.onEvent({ type: "thinking", data: chunk });
              params.onHistoryEvent({
                type: "assistant_thinking",
                text: chunk,
                timestamp: Date.now(),
              });
            }
          }
        }
      }

      if (evt.type === "tool_execution_start") {
        const toolName = (evt as { toolName?: string }).toolName ?? "unknown";
        const toolCallId = (evt as { toolCallId?: string }).toolCallId ?? `call_${Date.now()}`;
        const args = (evt as { args?: unknown }).args;

        params.onEvent({ type: "tool_start", toolName });
        params.onEvent({ type: "tool_call", id: toolCallId, name: toolName, arguments: args });
        params.onHistoryEvent({
          type: "tool_call",
          id: toolCallId,
          name: toolName,
          args,
          timestamp: Date.now(),
        });
      }

      if (evt.type === "tool_execution_end") {
        const toolName = (evt as { toolName?: string }).toolName ?? "unknown";
        const toolCallId = (evt as { toolCallId?: string }).toolCallId ?? "";
        const isError = (evt as { isError?: boolean }).isError ?? false;
        const rawResult = (evt as { result?: unknown }).result;

        // Extract text from result - handle both string and structured formats
        let content = "";
        if (typeof rawResult === "string") {
          content = rawResult;
        } else if (rawResult && typeof rawResult === "object") {
          // Handle structured content like {content: [{type: "text", text: "..."}]}
          const obj = rawResult as Record<string, unknown>;
          if (Array.isArray(obj.content)) {
            content = (obj.content as Array<Record<string, unknown>>)
              .filter((c) => c?.type === "text" && typeof c.text === "string")
              .map((c) => c.text as string)
              .join("\n");
          }
        }

        params.onEvent({ type: "tool_end", toolName, isError });
        params.onHistoryEvent({
          type: "tool_result",
          id: toolCallId,
          name: toolName,
          content,
          isError,
          timestamp: Date.now(),
        });
      }

      // Capture meta from message end
      if (evt.type === "message_end") {
        const msg = (evt as { message?: AgentMessage }).message;
        if (msg?.role === "assistant") {
          const assistantMsg = msg as unknown as Record<string, unknown>;
          params.onHistoryEvent({
            type: "meta",
            provider: assistantMsg.provider as string | undefined,
            model: assistantMsg.model as string | undefined,
            api: assistantMsg.api as string | undefined,
            usage: assistantMsg.usage as HistoryEvent extends { type: "meta"; usage?: infer U } ? U : undefined,
            stopReason: assistantMsg.stopReason as string | undefined,
            timestamp: Date.now(),
          });
          params.onHistoryEvent({ type: "turn_end", timestamp: Date.now() });
        }
      }
    });

    try {
      await agentSession.prompt(messageToSend, images && images.length > 0 ? { images } : undefined);
    } finally {
      unsubscribe();
    }

    // Extract text from last assistant message
    const messages = agentSession.messages;
    const lastAssistant = messages
      .slice()
      .reverse()
      .find((m: AgentMessage) => m.role === "assistant") as AssistantMessage | undefined;

    const finalText = lastAssistant ? extractAssistantText(lastAssistant) : "";

    agentSession.dispose();

    return { text: finalText, aborted };
  },

  async queueMessage(handle: unknown, message: string): Promise<void> {
    const piSession = handle as PiAgentSession;
    await piSession.sendUserMessage(message, { deliverAs: "steer" });
  },

  abort(handle: unknown): void {
    const piSession = handle as PiAgentSession;
    piSession.abort();
  },
};
