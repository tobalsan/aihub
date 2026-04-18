import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@mariozechner/pi-ai";
import type { AgentSession as PiAgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "@aihub/shared";
import { renderAgentContext } from "@aihub/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  SdkAdapter,
  SdkRunParams,
  SdkRunResult,
  HistoryEvent,
} from "../types.js";
import { CONFIG_DIR, loadConfig } from "../../config/index.js";
import { buildOnecliEnv } from "../../config/onecli.js";
import {
  ensureBootstrapFiles,
  loadBootstrapFiles,
  buildBootstrapContextFiles,
} from "../../agents/workspace.js";
import { getSessionCreatedAt } from "../../sessions/store.js";
import { resolveSessionDataFile } from "../../sessions/files.js";
import { createPiSubagentTools } from "@aihub/extension-projects/pi-tools";
import {
  getConnectorPromptsForAgent,
  getConnectorToolsForAgent,
} from "../../connectors/index.js";
import { getLoadedExtensions } from "../../extensions/registry.js";
import { repairOrphanedToolCalls } from "./session-repair.js";
import {
  appendAttachmentContext,
  buildDocumentAttachmentContext,
  isImageAttachment,
  readInboundAttachment,
} from "../attachments.js";

const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
let piEnvLock: Promise<void> = Promise.resolve();
const AIHUB_PI_SYSTEM_PROMPT = `You are an AI agent running inside AIHub, a self-hosted multi-agent gateway. AIHub provides a unified interface to orchestrate AI agents across multiple surfaces including web UI, CLI, Discord, scheduled jobs, and agent-to-agent messaging. Your role is determined by your configuration — you may operate as a coordinator planning and delegating work, a worker implementing tasks, a reviewer verifying quality, or a general-purpose assistant.

Available tools:
\${toolsList}

In addition to the tools above, you may have access to other custom tools provided by connectors or project configuration.

Guidelines:
\${guidelines}`;

async function ensureSessionsDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

/**
 * Resolve session file path with timestamp prefix support.
 * - For existing files: checks known timestamped path, then scans for any timestamped file, then legacy
 * - For new files: always creates timestamped filename (uses createdAt or defaults to now)
 */
async function resolveSessionFile(
  agentId: string,
  sessionId: string
): Promise<string> {
  await ensureSessionsDir();
  const createdAt = await getSessionCreatedAt(sessionId);
  return (await resolveSessionDataFile({
    dir: SESSIONS_DIR,
    agentId,
    sessionId,
    createdAt,
    createIfMissing: true,
  })) as string;
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

function stringifyToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result ?? null);
}

function createPiConnectorTools(agent: AgentConfig): AgentTool[] {
  return getConnectorToolsForAgent(agent, loadConfig()).map((tool) => ({
    name: tool.name,
    label: tool.description,
    description: tool.description,
    parameters: zodToJsonSchema(
      tool.parameters,
      `${tool.name}Parameters`
    ) as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, params) => {
      const result = await tool.execute(params);
      return {
        content: [{ type: "text", text: stringifyToolResult(result) }],
        details: result,
      };
    },
  }));
}

function hasProjectsComponentEnabled(): boolean {
  return getLoadedExtensions().some((extension) => extension.id === "projects");
}

async function withPiOnecliEnv<T>(
  agentId: string,
  fn: () => Promise<T>
): Promise<T> {
  const env = buildOnecliEnv(loadConfig(), agentId);
  if (!env) return fn();

  const prevLock = piEnvLock;
  let releaseLock: () => void;
  piEnvLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  await prevLock;

  const saved: Record<string, string | undefined> = {};
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) continue;
      saved[key] = process.env[key];
      process.env[key] = value;
    }

    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    releaseLock!();
  }
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
    return withPiOnecliEnv(params.agentId, async () => {
      const sessionFile = await resolveSessionFile(
        params.agentId,
        params.sessionId
      );

      // Ensure bootstrap files exist
      await ensureBootstrapFiles(params.workspaceDir);

      // Dynamically import pi-coding-agent
      const {
        createAgentSession,
        SessionManager,
        SettingsManager,
        AuthStorage,
        ModelRegistry,
        DefaultResourceLoader,
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
      const authStorage = AuthStorage.create(
        path.join(CONFIG_DIR, "auth.json")
      );
      const modelRegistry = ModelRegistry.create(
        authStorage,
        path.join(CONFIG_DIR, "models.json")
      );
      if (!agent.model.provider) {
        throw new Error(
          `Pi SDK requires model.provider to be set for agent: ${agent.id}`
        );
      }
      const model = modelRegistry.find(agent.model.provider, agent.model.model);

      if (!model) {
        throw new Error(
          `Model not found: ${agent.model.provider}/${agent.model.model}`
        );
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
        const auth = await modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok) {
          throw new Error(auth.error);
        }
        apiKey = auth.apiKey ?? null;
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
          throw new Error(
            `No API key for provider: ${model.provider}. Set ${envVar} env var.`
          );
        }
      } else {
        const auth = await modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok) {
          throw new Error(auth.error);
        }
        apiKey = auth.apiKey ?? null;
      }

      if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`);
      }
      authStorage.setRuntimeApiKey(model.provider, apiKey);

      // Load bootstrap context files
      const bootstrapFiles = await loadBootstrapFiles(params.workspaceDir);
      const contextFiles = buildBootstrapContextFiles(bootstrapFiles);

      // Create tools
      const tools = createCodingTools(params.workspaceDir);
      const connectorTools = createPiConnectorTools(agent);
      const projectsComponentEnabled = hasProjectsComponentEnabled();
      const customTools = projectsComponentEnabled
        ? createPiSubagentTools().map((tool: any) => ({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            parameters: tool.parameters,
            execute: async (
              toolCallId: string,
              params: unknown,
              _signal: AbortSignal | undefined,
              _onUpdate: unknown,
              _ctx: unknown
            ) => tool.execute(toolCallId, params),
          }))
        : [];
      const subagentToolPrompt = projectsComponentEnabled
        ? [
            "Additional tools:",
            "- subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch?, resume? }",
            "- subagent.status { projectId, slug }",
            "- subagent.logs { projectId, slug, since? }",
            "- subagent.interrupt { projectId, slug }",
          ].join("\n")
        : undefined;
      const connectorPrompts = getConnectorPromptsForAgent(agent);
      const connectorContextFiles = connectorPrompts.map((cp) => ({
        path: `connector:${cp.id}`,
        content: cp.prompt,
      }));
      const allAppendedPrompts = subagentToolPrompt
        ? [subagentToolPrompt]
        : undefined;

      const sessionManager = SessionManager.open(sessionFile, SESSIONS_DIR);
      const settingsManager = SettingsManager.create(
        params.workspaceDir,
        CONFIG_DIR
      );
      const globalSkillsDir = path.join(os.homedir(), ".agents", "skills");
      const includeGlobalSkills = agent.globalSkills === true;

      const workspaceSkillsDir = path.join(params.workspaceDir, "skills");

      const resourceLoader = new DefaultResourceLoader({
        cwd: params.workspaceDir,
        agentDir: CONFIG_DIR,
        settingsManager,
        systemPromptOverride: () => AIHUB_PI_SYSTEM_PROMPT,
        appendSystemPrompt: allAppendedPrompts,
        additionalSkillPaths: [workspaceSkillsDir],
        agentsFilesOverride: () => ({
          agentsFiles: [...contextFiles, ...connectorContextFiles],
        }),
        ...(!includeGlobalSkills && {
          skillsOverride: (result) => ({
            skills: result.skills.filter(
              (s) => !s.filePath.startsWith(globalSkillsDir)
            ),
            diagnostics: result.diagnostics,
          }),
        }),
      });
      await resourceLoader.reload();

      const { session: agentSession } = await createAgentSession({
        cwd: params.workspaceDir,
        agentDir: CONFIG_DIR,
        authStorage,
        modelRegistry,
        model,
        ...(params.thinkLevel && { thinkingLevel: params.thinkLevel }),
        tools,
        customTools: [...customTools, ...connectorTools],
        resourceLoader,
        sessionManager,
        settingsManager,
      });

      // Repair orphaned tool calls from interrupted sessions
      repairOrphanedToolCalls(agentSession);

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

      // Load images from file paths
      let images: ImageContent[] | undefined;
      if (params.attachments && params.attachments.length > 0) {
        const imageAttachments = params.attachments.filter(isImageAttachment);
        if (imageAttachments.length > 0) {
          images = await Promise.all(
            imageAttachments.map(async (attachment) => {
              const buffer = await readInboundAttachment(attachment);
              return {
                type: "image" as const,
                data: buffer.toString("base64"),
                mimeType: attachment.mimeType,
              };
            })
          );
        }
      }

      // Build message with context preamble (if any)
      const messageToSend = contextPreamble
        ? `${contextPreamble}\n\n${params.message}`
        : params.message;
      const attachmentContext = await buildDocumentAttachmentContext(
        params.attachments
      );
      const messageWithAttachments = appendAttachmentContext(
        messageToSend,
        attachmentContext
      );

      // Emit user message to history (without context preamble)
      params.onHistoryEvent({
        type: "user",
        text: params.message,
        attachments: params.attachments,
        timestamp: Date.now(),
      });

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
          const toolCallId =
            (evt as { toolCallId?: string }).toolCallId ?? `call_${Date.now()}`;
          const args = (evt as { args?: unknown }).args;

          params.onEvent({ type: "tool_start", toolName });
          params.onEvent({
            type: "tool_call",
            id: toolCallId,
            name: toolName,
            arguments: args,
          });
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
          params.onEvent({
            type: "tool_result",
            id: toolCallId,
            name: toolName,
            content,
            isError,
          });
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
              usage: assistantMsg.usage as HistoryEvent extends {
                type: "meta";
                usage?: infer U;
              }
                ? U
                : undefined,
              stopReason: assistantMsg.stopReason as string | undefined,
              timestamp: Date.now(),
            });
            params.onHistoryEvent({ type: "turn_end", timestamp: Date.now() });
          }
        }
      });

      try {
        await agentSession.prompt(
          messageWithAttachments,
          images && images.length > 0 ? { images } : undefined
        );
      } finally {
        unsubscribe();
      }

      const messages = agentSession.messages;
      const lastAssistant = messages
        .slice()
        .reverse()
        .find((m: AgentMessage) => m.role === "assistant") as
        | AssistantMessage
        | undefined;

      const lastAssistantRecord = lastAssistant as
        | (Record<string, unknown> & AssistantMessage)
        | undefined;
      if (lastAssistantRecord?.stopReason === "error") {
        const errorMessage =
          typeof lastAssistantRecord.errorMessage === "string" &&
          lastAssistantRecord.errorMessage
            ? lastAssistantRecord.errorMessage
            : "unknown error";
        const errorStr = `Agent error: ${errorMessage}`;
        console.error(`[${params.agent.id}] ${errorStr}`);
        agentSession.dispose();
        throw new Error(errorStr);
      }

      const finalText = lastAssistant
        ? extractAssistantText(lastAssistant)
        : "";

      agentSession.dispose();

      return { text: finalText, aborted };
    });
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
