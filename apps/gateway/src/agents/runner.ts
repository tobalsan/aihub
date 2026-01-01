import fs from "node:fs/promises";
import path from "node:path";
import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentSession as PiAgentSession, Skill } from "@mariozechner/pi-coding-agent";
import type { ThinkLevel, StreamEvent } from "@aihub/shared";
import { getAgent, resolveWorkspaceDir, CONFIG_DIR } from "../config/index.js";
import {
  setSessionStreaming,
  isStreaming,
  abortSession,
  setAgentSession,
  getAgentSession,
  clearAgentSession,
  bufferPendingMessage,
  popPendingMessages,
} from "./sessions.js";

export type RunAgentParams = {
  agentId: string;
  message: string;
  sessionId?: string;
  thinkLevel?: ThinkLevel;
  onEvent?: (event: StreamEvent) => void;
};

export type RunAgentResult = {
  payloads: Array<{ text?: string; mediaUrls?: string[] }>;
  meta: {
    durationMs: number;
    sessionId: string;
    aborted?: boolean;
    queued?: boolean;
  };
};

const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");

// Max wait time for Pi session to be set during queue race
const QUEUE_WAIT_MS = 500;
const QUEUE_POLL_MS = 10;

// Max wait time for streaming to end during interrupt
const INTERRUPT_WAIT_MS = 2000;
const INTERRUPT_POLL_MS = 50;

async function ensureSessionsDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

function resolveSessionFile(agentId: string, sessionId: string): string {
  return path.join(SESSIONS_DIR, `${agentId}-${sessionId}.jsonl`);
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

/** Wait for Pi session to be available, with timeout */
async function waitForPiSession(
  agentId: string,
  sessionId: string
): Promise<PiAgentSession | undefined> {
  const deadline = Date.now() + QUEUE_WAIT_MS;
  while (Date.now() < deadline) {
    const session = getAgentSession(agentId, sessionId);
    if (session) return session;
    await new Promise((r) => setTimeout(r, QUEUE_POLL_MS));
  }
  return undefined;
}

/** Wait for streaming to end, with timeout */
async function waitForStreamingEnd(agentId: string, sessionId: string): Promise<boolean> {
  const deadline = Date.now() + INTERRUPT_WAIT_MS;
  while (Date.now() < deadline) {
    if (!isStreaming(agentId, sessionId)) return true;
    await new Promise((r) => setTimeout(r, INTERRUPT_POLL_MS));
  }
  return false;
}

/** Load skills from workspaceDir/.pi/skills if it exists */
async function loadWorkspaceSkills(workspaceDir: string): Promise<Skill[]> {
  const skillsDir = path.join(workspaceDir, ".pi", "skills");
  try {
    const stat = await fs.stat(skillsDir);
    if (!stat.isDirectory()) return [];

    const { loadSkillsFromDir } = await import("@mariozechner/pi-coding-agent");
    const result = loadSkillsFromDir({ dir: skillsDir, source: "workspace" });
    return result.skills;
  } catch {
    // Directory doesn't exist or not readable
    return [];
  }
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const agent = getAgent(params.agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${params.agentId}`);
  }

  const sessionId = params.sessionId ?? "default";
  const currentlyStreaming = isStreaming(params.agentId, sessionId);

  // Handle queue vs interrupt mode when already streaming
  if (currentlyStreaming) {
    if (agent.queueMode === "queue") {
      // Wait for Pi session to be set (handles race with setSessionStreaming)
      const existingPiSession = await waitForPiSession(params.agentId, sessionId);

      if (existingPiSession) {
        // Queue mode: inject message into current Pi session
        await existingPiSession.queueMessage(params.message);
      } else {
        // Pi session not ready yet - buffer the message for later injection
        bufferPendingMessage(params.agentId, sessionId, params.message);
      }

      params.onEvent?.({ type: "text", data: "Message queued into current run" });
      params.onEvent?.({ type: "done", meta: { durationMs: 0 } });
      return {
        payloads: [{ text: "Message queued into current run" }],
        meta: { durationMs: 0, sessionId, queued: true },
      };
    }

    if (agent.queueMode === "interrupt") {
      // Interrupt mode: abort existing session and wait for it to end
      abortSession(params.agentId, sessionId);
      const ended = await waitForStreamingEnd(params.agentId, sessionId);
      if (!ended) {
        // Force clear the streaming state if it didn't end gracefully
        clearAgentSession(params.agentId, sessionId);
        setSessionStreaming(params.agentId, sessionId, false);
      }
    }
  }

  await ensureSessionsDir();
  const sessionFile = resolveSessionFile(params.agentId, sessionId);
  const workspaceDir = resolveWorkspaceDir(agent.workspace);

  const abortController = new AbortController();
  setSessionStreaming(params.agentId, sessionId, true, abortController);

  const started = Date.now();
  let aborted = false;

  try {
    // Dynamically import pi-coding-agent
    const {
      createAgentSession,
      SessionManager,
      SettingsManager,
      discoverAuthStorage,
      discoverModels,
      buildSystemPrompt,
      codingTools,
    } = await import("@mariozechner/pi-coding-agent");
    const { getEnvApiKey } = await import("@mariozechner/pi-ai");

    // Resolve model - use CONFIG_DIR directly so Pi SDK reads ~/.aihub/models.json
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    const authStorage = discoverAuthStorage(CONFIG_DIR);
    const modelRegistry = discoverModels(authStorage, CONFIG_DIR);
    const model = modelRegistry.find(agent.model.provider, agent.model.model);

    if (!model) {
      throw new Error(`Model not found: ${agent.model.provider}/${agent.model.model}`);
    }

    // Get API key
    const storedKey = await authStorage.getApiKey(model.provider);
    const apiKey = storedKey ?? getEnvApiKey(model.provider);
    if (!apiKey) {
      throw new Error(`No API key for provider: ${model.provider}`);
    }
    authStorage.setRuntimeApiKey(model.provider, apiKey);

    // Load skills from workspace
    const skills = await loadWorkspaceSkills(workspaceDir);

    // Build system prompt with skills
    const systemPrompt = buildSystemPrompt({
      cwd: workspaceDir,
      contextFiles: [],
      skills,
      tools: codingTools,
    });

    const sessionManager = SessionManager.open(sessionFile, CONFIG_DIR);
    const settingsManager = SettingsManager.create(workspaceDir, CONFIG_DIR);

    const { session: agentSession } = await createAgentSession({
      cwd: workspaceDir,
      agentDir: CONFIG_DIR,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: params.thinkLevel ?? agent.thinkLevel ?? "off",
      systemPrompt,
      tools: codingTools,
      sessionManager,
      settingsManager,
      skills,
      contextFiles: [],
    });

    // Store the Pi session for queue injection BEFORE any async work
    setAgentSession(params.agentId, sessionId, agentSession as PiAgentSession);

    // Inject any buffered messages that arrived before Pi session was ready
    const bufferedMessages = popPendingMessages(params.agentId, sessionId);
    for (const bufferedMsg of bufferedMessages) {
      await agentSession.queueMessage(bufferedMsg);
    }

    // Handle abort
    abortController.signal.addEventListener("abort", () => {
      aborted = true;
      agentSession.abort();
    });

    // Subscribe to streaming events
    let deltaBuffer = "";
    const unsubscribe = agentSession.subscribe((evt) => {
      if (evt.type === "message_update") {
        const msg = (evt as { message?: AppMessage }).message;
        if (msg?.role === "assistant") {
          const assistantEvent = (evt as { assistantMessageEvent?: unknown })
            .assistantMessageEvent as Record<string, unknown> | undefined;
          const evtType = assistantEvent?.type as string | undefined;

          if (evtType === "text_delta" || evtType === "text_start" || evtType === "text_end") {
            const chunk =
              (assistantEvent?.delta as string) ?? (assistantEvent?.content as string) ?? "";
            if (chunk) {
              deltaBuffer += chunk;
              params.onEvent?.({ type: "text", data: chunk });
            }
          }
        }
      }

      if (evt.type === "tool_execution_start") {
        const toolName = (evt as { toolName?: string }).toolName ?? "unknown";
        params.onEvent?.({ type: "tool_start", toolName });
      }

      if (evt.type === "tool_execution_end") {
        const toolName = (evt as { toolName?: string }).toolName ?? "unknown";
        const isError = (evt as { isError?: boolean }).isError ?? false;
        params.onEvent?.({ type: "tool_end", toolName, isError });
      }
    });

    try {
      // Run the prompt
      await agentSession.prompt(params.message);
    } finally {
      unsubscribe();
    }

    const durationMs = Date.now() - started;
    params.onEvent?.({ type: "done", meta: { durationMs } });

    // Extract text from the last assistant message
    const messages = agentSession.messages;
    const lastAssistant = messages
      .slice()
      .reverse()
      .find((m: AppMessage) => m.role === "assistant") as AssistantMessage | undefined;

    const assistantText = lastAssistant ? extractAssistantText(lastAssistant) : "";

    agentSession.dispose();

    return {
      payloads: assistantText ? [{ text: assistantText }] : [],
      meta: { durationMs, sessionId, aborted },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    params.onEvent?.({ type: "error", message });
    throw err;
  } finally {
    clearAgentSession(params.agentId, sessionId);
    setSessionStreaming(params.agentId, sessionId, false);
  }
}

export async function queueOrRun(params: RunAgentParams): Promise<RunAgentResult> {
  // This function is now simplified - runAgent handles queue/interrupt internally
  return runAgent(params);
}
