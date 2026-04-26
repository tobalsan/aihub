import fs from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createCodingTools,
  type AgentSession,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import {
  renderAgentContext,
  type AgentContext,
  type ContainerInput,
  type ContainerOutput,
} from "@aihub/shared";
import { callGatewayTool } from "./gateway-client.js";
import {
  abortClaudeAgent,
  runClaudeAgent,
  sendClaudeFollowUpMessage,
} from "./claude-runner.js";

type HistoryEvent =
  | {
      type: "system_prompt";
      text: string;
      timestamp: number;
    }
  | {
      type: "system_context";
      context: ContainerInput["context"];
      rendered: string;
      timestamp: number;
    }
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
      timestamp: number;
    }
  | {
      type: "meta";
      provider?: string;
      model?: string;
      api?: string;
      usage?: unknown;
      stopReason?: string;
      timestamp: number;
    }
  | { type: "turn_end"; timestamp: number };

const BOOTSTRAP_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "BOOTSTRAP.md",
] as const;

const AIHUB_PI_SYSTEM_PROMPT = `You are an AI agent running inside an isolated AIHub container. Use the mounted workspace as your working directory. Coding tools run inside this container. Orchestration tools call back to the gateway.

To share a file with the user, write it to /workspace/data/ then use the send_file tool. The file will appear as a downloadable card in the chat.

Available tools:
\${toolsList}

Guidelines:
\${guidelines}`;

let activeSession: AgentSession | undefined;
let pendingFollowUps: string[] = [];
let activeSdk: "pi" | "claude" | undefined;

export async function sendFollowUpMessage(message: unknown): Promise<void> {
  if (activeSdk === "claude") {
    await sendClaudeFollowUpMessage(message);
    return;
  }

  const text = getIpcMessageText(message);
  if (!text) return;

  if (!activeSession) {
    pendingFollowUps.push(text);
    return;
  }

  await activeSession.sendUserMessage(text, { deliverAs: "steer" });
}

export function abortActiveAgent(): void {
  if (activeSdk === "claude") {
    abortClaudeAgent();
    return;
  }
  void activeSession?.abort();
}

export async function runAgent(
  input: ContainerInput,
  onStreamEvent?: (event: unknown) => void
): Promise<ContainerOutput> {
  if (input.sdkConfig.sdk === "claude") {
    activeSdk = "claude";
    try {
      return await runClaudeAgent(input);
    } finally {
      activeSdk = undefined;
    }
  }

  if (input.sdkConfig.sdk !== "pi") {
    throw new Error(`Unsupported sandbox SDK: ${input.sdkConfig.sdk}`);
  }

  activeSdk = "pi";

  try {
    console.error(
      `[agent-runner] Running agent ${input.agentId} with SDK ${input.sdkConfig.sdk}`
    );

    activeSession = undefined;

    const provider = input.sdkConfig.model.provider;
    if (!provider) {
      throw new Error(
        `Pi SDK requires model.provider for agent: ${input.agentId}`
      );
    }

    const history: HistoryEvent[] = [];
    const context = input.context as AgentContext | undefined;
    const renderedContext = context ? renderAgentContext(context) : "";
    const promptText = renderedContext
      ? `${renderedContext}\n\n${input.message}`
      : input.message;
    if (renderedContext && context) {
      const systemContextEvent: HistoryEvent = {
        type: "system_context",
        context,
        rendered: renderedContext,
        timestamp: Date.now(),
      };
      history.push(systemContextEvent);
      onStreamEvent?.(systemContextEvent);
    }
    history.push({ type: "user", text: input.message, timestamp: Date.now() });
    let aborted = false;

    const sessionRoot = path.join(input.sessionDir, input.agentId);
    await fs.mkdir(sessionRoot, { recursive: true });
    const sessionFile = path.join(sessionRoot, `${input.sessionId}.json`);

    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(provider, "onecli-proxy-managed");
    const modelRegistry = ModelRegistry.create(
      authStorage,
      path.join(input.sessionDir, "models.json")
    );
    const model = modelRegistry.find(provider, input.sdkConfig.model.model);
    if (!model) {
      throw new Error(
        `Model not found: ${provider}/${input.sdkConfig.model.model}`
      );
    }

    const contextFiles = await loadContextFiles(input);
    const settingsManager = SettingsManager.create(
      input.workspaceDir,
      input.sessionDir
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.workspaceDir,
      agentDir: input.sessionDir,
      settingsManager,
      additionalSkillPaths: [path.join(input.workspaceDir, "skills")],
      systemPromptOverride: () => AIHUB_PI_SYSTEM_PROMPT,
      appendSystemPrompt: [
        orchestrationToolPrompt(),
        ...(input.extensionSystemPrompts ?? []),
        renderedContext || undefined,
      ].filter((prompt): prompt is string => Boolean(prompt)),
      agentsFilesOverride: () => ({ agentsFiles: contextFiles }),
    });
    await resourceLoader.reload();

    const sessionManager = SessionManager.open(sessionFile, sessionRoot);
    const tools = createCodingTools(input.workspaceDir);
    const customTools = [
      ...createOrchestrationTools(input),
      ...createConnectorTools(input),
      createSendFileTool(onStreamEvent),
    ];

    const { session } = await createAgentSession({
      cwd: input.workspaceDir,
      agentDir: input.sessionDir,
      authStorage,
      modelRegistry,
      model,
      ...(input.thinkLevel && { thinkingLevel: input.thinkLevel }),
      tools,
      customTools,
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    activeSession = session;

    const systemPrompt = session.agent.state.systemPrompt;
    if (typeof systemPrompt === "string" && systemPrompt.trim().length > 0) {
      const systemPromptEvent: HistoryEvent = {
        type: "system_prompt",
        text: systemPrompt,
        timestamp: Date.now(),
      };
      history.push(systemPromptEvent);
      onStreamEvent?.(systemPromptEvent);
    }

    const unsubscribe = session.subscribe((evt) => {
      const collectedEvents = collectHistoryEvent(evt, history);
      for (const event of collectedEvents) {
        onStreamEvent?.(event);
      }
    });

    try {
      for (const message of pendingFollowUps.splice(0)) {
        await session.sendUserMessage(message, { deliverAs: "steer" });
      }

      await session.prompt(promptText, await loadPromptOptions(input));
    } catch (error) {
      if (isAbortLikeError(error)) {
        aborted = true;
      } else {
        session.dispose();
        activeSession = undefined;
        pendingFollowUps = [];
        throw error;
      }
    } finally {
      unsubscribe();
    }

    const lastAssistant = findLastAssistant(session.messages);
    const lastAssistantRecord = lastAssistant as
      | (Record<string, unknown> & AssistantMessage)
      | undefined;
    if (lastAssistantRecord?.stopReason === "error") {
      const message =
        typeof lastAssistantRecord.errorMessage === "string" &&
        lastAssistantRecord.errorMessage
          ? lastAssistantRecord.errorMessage
          : "unknown error";
      session.dispose();
      activeSession = undefined;
      pendingFollowUps = [];
      throw new Error(`Agent error: ${message}`);
    }

    const text = lastAssistant ? extractAssistantText(lastAssistant) : "";
    session.dispose();
    activeSession = undefined;
    pendingFollowUps = [];

    return { text, aborted, history };
  } finally {
    activeSdk = undefined;
  }
}

async function loadBootstrapContextFiles(
  workspaceDir: string
): Promise<Array<{ path: string; content: string }>> {
  const files = await Promise.allSettled(
    BOOTSTRAP_FILENAMES.map(async (name) => ({
      path: name,
      content: await fs.readFile(path.join(workspaceDir, name), "utf8"),
    }))
  );

  const contextFiles: Array<{ path: string; content: string }> = [];
  for (const result of files) {
    if (result.status === "fulfilled") {
      contextFiles.push(result.value);
    }
  }
  return contextFiles;
}

async function loadContextFiles(
  input: ContainerInput
): Promise<Array<{ path: string; content: string }>> {
  const contextFiles = await loadBootstrapContextFiles(input.workspaceDir);
  for (const connector of input.connectorConfigs ?? []) {
    if (!connector.systemPrompt?.trim()) {
      continue;
    }
    contextFiles.push({
      path: `CONNECTOR_${connector.id}.md`,
      content: connector.systemPrompt,
    });
  }
  return contextFiles;
}

function orchestrationToolPrompt(): string {
  return [
    "Additional orchestration tools:",
    "- project.create { title, readme?, specs?, domain?, owner?, status? }",
    "- project.get { projectId }",
    "- project.update { projectId, updates }",
    "- project.comment { projectId, author, message }",
  ].join("\n");
}

function createOrchestrationTools(input: ContainerInput): ToolDefinition[] {
  return [
    gatewayTool(
      input,
      "project.create",
      "Create project",
      "Create an AIHub project",
      {
        type: "object",
        properties: {
          title: { type: "string" },
          readme: { type: "string" },
          specs: { type: "string" },
          domain: { type: "string" },
          owner: { type: "string" },
          status: { type: "string" },
        },
        required: ["title"],
      }
    ),
    gatewayTool(input, "project.get", "Get project", "Get an AIHub project", {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    }),
    gatewayTool(
      input,
      "project.update",
      "Update project",
      "Update an AIHub project",
      {
        type: "object",
        properties: {
          projectId: { type: "string" },
          updates: { type: "object" },
        },
        required: ["projectId"],
      }
    ),
    gatewayTool(
      input,
      "project.comment",
      "Comment on project",
      "Add a comment to an AIHub project",
      {
        type: "object",
        properties: {
          projectId: { type: "string" },
          author: { type: "string" },
          message: { type: "string" },
        },
        required: ["projectId", "author", "message"],
      }
    ),
  ];
}

function createConnectorTools(input: ContainerInput): ToolDefinition[] {
  return (input.connectorConfigs ?? []).flatMap((connector) =>
    connector.tools.map((tool) => ({
      name: tool.name,
      label: tool.description,
      description: tool.description,
      parameters: tool.parameters as ToolDefinition["parameters"],
      execute: async (_toolCallId, params) => {
        const result = await callConnectorTool(
          input,
          connector.id,
          tool.name,
          params,
          input.agentId
        );
        return {
          content: [{ type: "text", text: stringifyToolResult(result) }],
          details: result,
        };
      },
    }))
  );
}

function createSendFileTool(
  onStreamEvent?: (event: unknown) => void
): ToolDefinition {
  return {
    name: "send_file",
    label: "Send file to user",
    description:
      "Send a file from /workspace/data/ to the user. The file appears as a downloadable card in chat. Write the file first, then call this tool with its path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the file, e.g. /workspace/data/report.csv",
        },
      },
      required: ["path"],
    } as unknown as ToolDefinition["parameters"],
    execute: async (_toolCallId, params) => {
      const filePath = (params as { path: string }).path;
      if (!filePath.startsWith("/workspace/data/")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: path must be inside /workspace/data/",
            },
          ],
          details: undefined,
        };
      }
      onStreamEvent?.({ type: "file_output", path: filePath });
      return {
        content: [{ type: "text", text: `File sent to user: ${filePath}` }],
        details: undefined,
      };
    },
  };
}

async function callConnectorTool(
  input: ContainerInput,
  connectorId: string,
  tool: string,
  args: unknown,
  agentId: string
): Promise<unknown> {
  const url = new URL("/connectors/tools", input.gatewayUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Agent-Id": agentId,
      "X-Agent-Token": input.agentToken,
    },
    body: JSON.stringify({
      connectorId,
      tool,
      args,
      agentId,
      agentToken: input.agentToken,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Connector tool ${tool} failed with ${response.status}: ${text.slice(0, 200)}`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Connector tool ${tool} returned non-JSON body: ${text.slice(0, 200)}`
    );
  }
}

function gatewayTool(
  input: ContainerInput,
  name: string,
  label: string,
  description: string,
  parameters: unknown
): ToolDefinition {
  return {
    name,
    label,
    description,
    parameters: parameters as ToolDefinition["parameters"],
    execute: async (_toolCallId, params) => {
      const result = await callGatewayTool(
        input.gatewayUrl,
        input.agentToken,
        name,
        params,
        input.agentId
      );
      return {
        content: [{ type: "text", text: stringifyToolResult(result) }],
        details: result,
      };
    },
  };
}

async function loadPromptOptions(
  input: ContainerInput
): Promise<{ images?: ImageContent[] } | undefined> {
  const imageAttachments = input.attachments?.filter((attachment) =>
    attachment.mimeType.startsWith("image/")
  );
  if (!imageAttachments?.length) return undefined;

  const images = await Promise.all(
    imageAttachments.map(async (attachment) => {
      const buffer = await fs.readFile(attachment.path);
      return {
        type: "image" as const,
        data: buffer.toString("base64"),
        mimeType: attachment.mimeType,
      };
    })
  );
  return { images };
}

function collectHistoryEvent(
  evt: unknown,
  history: HistoryEvent[]
): HistoryEvent[] {
  const event = evt as Record<string, unknown>;
  const collected: HistoryEvent[] = [];

  if (event.type === "message_update") {
    const msg = event.message as AgentMessage | undefined;
    if (msg?.role !== "assistant") return collected;

    const assistantEvent = event.assistantMessageEvent as
      | Record<string, unknown>
      | undefined;
    if (assistantEvent?.type === "text_delta") {
      const text = assistantEvent.delta;
      if (typeof text === "string" && text) {
        collected.push({ type: "assistant_text", text, timestamp: Date.now() });
      }
    }
    if (assistantEvent?.type === "thinking_delta") {
      const text = assistantEvent.delta;
      if (typeof text === "string" && text) {
        collected.push({
          type: "assistant_thinking",
          text,
          timestamp: Date.now(),
        });
      }
    }
  }

  if (event.type === "tool_execution_start") {
    collected.push({
      type: "tool_call",
      id: typeof event.toolCallId === "string" ? event.toolCallId : "",
      name: typeof event.toolName === "string" ? event.toolName : "unknown",
      args: event.args,
      timestamp: Date.now(),
    });
  }

  if (event.type === "tool_execution_end") {
    collected.push({
      type: "tool_result",
      id: typeof event.toolCallId === "string" ? event.toolCallId : "",
      name: typeof event.toolName === "string" ? event.toolName : "unknown",
      content: extractToolResultText(event.result),
      isError: event.isError === true,
      timestamp: Date.now(),
    });
  }

  if (event.type === "message_end") {
    const msg = event.message as AgentMessage | undefined;
    if (msg?.role !== "assistant") return collected;
    const assistant = msg as unknown as Record<string, unknown>;
    collected.push({
      type: "meta",
      provider:
        typeof assistant.provider === "string" ? assistant.provider : undefined,
      model: typeof assistant.model === "string" ? assistant.model : undefined,
      api: typeof assistant.api === "string" ? assistant.api : undefined,
      usage: assistant.usage,
      stopReason:
        typeof assistant.stopReason === "string"
          ? assistant.stopReason
          : undefined,
      timestamp: Date.now(),
    });
    collected.push({ type: "turn_end", timestamp: Date.now() });
  }

  history.push(...collected);
  return collected;
}

function findLastAssistant(
  messages: AgentMessage[]
): AssistantMessage | undefined {
  return messages
    .slice()
    .reverse()
    .find(
      (message): message is AssistantMessage => message.role === "assistant"
    );
}

function extractAssistantText(message: AssistantMessage): string {
  if (!message.content) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(
        (item): item is { type: "text"; text: string } => item.type === "text"
      )
      .map((item) => item.text)
      .join("\n");
  }
  return "";
}

function extractToolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (item): item is { type: "text"; text: string } =>
            item?.type === "text" && typeof item.text === "string"
        )
        .map((item) => item.text)
        .join("\n");
    }
  }
  return stringifyToolResult(result);
}

function stringifyToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result ?? null);
}

function getIpcMessageText(message: unknown): string | undefined {
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && "message" in message) {
    const text = (message as { message?: unknown }).message;
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
