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
import type { ContainerInput, ContainerOutput } from "@aihub/shared";
import { callGatewayTool } from "./gateway-client.js";

type HistoryEvent =
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

Available tools:
\${toolsList}

Guidelines:
\${guidelines}`;

let activeSession: AgentSession | undefined;
let pendingFollowUps: string[] = [];

export async function sendFollowUpMessage(message: unknown): Promise<void> {
  const text = getIpcMessageText(message);
  if (!text) return;

  if (!activeSession) {
    pendingFollowUps.push(text);
    return;
  }

  await activeSession.sendUserMessage(text, { deliverAs: "steer" });
}

export function abortActiveAgent(): void {
  void activeSession?.abort();
}

export async function runAgent(
  input: ContainerInput
): Promise<ContainerOutput> {
  if (input.sdkConfig.sdk !== "pi") {
    throw new Error(`Unsupported sandbox SDK: ${input.sdkConfig.sdk}`);
  }

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

  const history: HistoryEvent[] = [
    { type: "user", text: input.message, timestamp: Date.now() },
  ];
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

  const contextFiles = await loadBootstrapContextFiles(input.workspaceDir);
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
    appendSystemPrompt: orchestrationToolPrompt(),
    agentsFilesOverride: () => ({ agentsFiles: contextFiles }),
  });
  await resourceLoader.reload();

  const sessionManager = SessionManager.open(sessionFile, sessionRoot);
  const tools = createCodingTools(input.workspaceDir);
  // TODO: Wire connector tools once connector config is included in ContainerInput.
  const customTools = createOrchestrationTools(input);

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

  const unsubscribe = session.subscribe((evt) => {
    collectHistoryEvent(evt, history);
  });

  try {
    for (const message of pendingFollowUps.splice(0)) {
      await session.sendUserMessage(message, { deliverAs: "steer" });
    }

    await session.prompt(input.message, await loadPromptOptions(input));
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

function orchestrationToolPrompt(): string {
  return [
    "Additional orchestration tools:",
    "- subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch?, resume? }",
    "- subagent.status { projectId, slug }",
    "- subagent.logs { projectId, slug, since? }",
    "- subagent.interrupt { projectId, slug }",
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
      "subagent.spawn",
      "Spawn subagent",
      "Spawn an external CLI subagent",
      {
        type: "object",
        properties: {
          projectId: { type: "string" },
          slug: { type: "string" },
          cli: { type: "string" },
          prompt: { type: "string" },
          mode: { type: "string" },
          baseBranch: { type: "string" },
          resume: { type: "boolean" },
        },
        required: ["projectId", "slug", "cli", "prompt"],
      }
    ),
    gatewayTool(
      input,
      "subagent.status",
      "Subagent status",
      "Get subagent status",
      {
        type: "object",
        properties: {
          projectId: { type: "string" },
          slug: { type: "string" },
        },
        required: ["projectId", "slug"],
      }
    ),
    gatewayTool(
      input,
      "subagent.logs",
      "Subagent logs",
      "Fetch subagent logs",
      {
        type: "object",
        properties: {
          projectId: { type: "string" },
          slug: { type: "string" },
          since: { type: "number" },
        },
        required: ["projectId", "slug"],
      }
    ),
    gatewayTool(
      input,
      "subagent.interrupt",
      "Interrupt subagent",
      "Interrupt a running subagent",
      {
        type: "object",
        properties: {
          projectId: { type: "string" },
          slug: { type: "string" },
        },
        required: ["projectId", "slug"],
      }
    ),
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

function collectHistoryEvent(evt: unknown, history: HistoryEvent[]): void {
  const event = evt as Record<string, unknown>;

  if (event.type === "message_update") {
    const msg = event.message as AgentMessage | undefined;
    if (msg?.role !== "assistant") return;

    const assistantEvent = event.assistantMessageEvent as
      | Record<string, unknown>
      | undefined;
    if (assistantEvent?.type === "text_delta") {
      const text = assistantEvent.delta;
      if (typeof text === "string" && text) {
        history.push({ type: "assistant_text", text, timestamp: Date.now() });
      }
    }
    if (assistantEvent?.type === "thinking_delta") {
      const text = assistantEvent.delta;
      if (typeof text === "string" && text) {
        history.push({
          type: "assistant_thinking",
          text,
          timestamp: Date.now(),
        });
      }
    }
  }

  if (event.type === "tool_execution_start") {
    history.push({
      type: "tool_call",
      id: typeof event.toolCallId === "string" ? event.toolCallId : "",
      name: typeof event.toolName === "string" ? event.toolName : "unknown",
      args: event.args,
      timestamp: Date.now(),
    });
  }

  if (event.type === "tool_execution_end") {
    history.push({
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
    if (msg?.role !== "assistant") return;
    const assistant = msg as unknown as Record<string, unknown>;
    history.push({
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
    history.push({ type: "turn_end", timestamp: Date.now() });
  }
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
