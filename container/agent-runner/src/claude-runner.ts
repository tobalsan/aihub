import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  renderAgentContext,
  type AgentContext,
  type ContainerInput,
  type ContainerOutput,
} from "@aihub/shared";

type ClaudeRunnerState = {
  sessionId?: string;
};

let activeProcess: ChildProcess | undefined;
let pendingFollowUps: string[] = [];

export async function sendClaudeFollowUpMessage(message: unknown): Promise<void> {
  const text = getIpcMessageText(message);
  if (!text) return;
  pendingFollowUps.push(text);
}

export function abortClaudeAgent(): void {
  activeProcess?.kill("SIGTERM");
}

export async function runClaudeAgent(
  input: ContainerInput
): Promise<ContainerOutput> {
  console.error(
    `[agent-runner] Running agent ${input.agentId} with SDK ${input.sdkConfig.sdk}`
  );

  const history: Array<{ type: string; [key: string]: unknown }> = [
  ];
  const context = input.context as AgentContext | undefined;
  const renderedContext = context ? renderAgentContext(context) : "";
  const promptText = renderedContext
    ? `${renderedContext}\n\n${input.message}`
    : input.message;
  if (renderedContext && context) {
    history.push({
      type: "system_context",
      context,
      rendered: renderedContext,
      timestamp: Date.now(),
    });
  }
  history.push({ type: "user", text: input.message, timestamp: Date.now() });

  const sessionRoot = path.join(input.sessionDir, input.agentId);
  await fs.mkdir(sessionRoot, { recursive: true });
  const statePath = path.join(sessionRoot, `${input.sessionId}.json`);
  const promptPath = path.join(sessionRoot, `${input.sessionId}.prompt.txt`);

  const state = await readState(statePath);
  const queuedFollowUps = pendingFollowUps.splice(0);
  const prompt = buildPrompt(promptText, queuedFollowUps);
  await fs.writeFile(promptPath, prompt, "utf8");

  const args = ["--print", "--output-format", "json"];
  if (renderedContext) {
    args.push("--append-system-prompt", renderedContext);
  }
  args.push("-p", prompt);
  if (input.sdkConfig.model.model) {
    args.push("--model", input.sdkConfig.model.model);
  }
  if (state.sessionId) {
    args.push("-r", state.sessionId);
  }

  const env = {
    ...process.env,
    ...(input.sdkConfig.model.base_url
      ? { ANTHROPIC_BASE_URL: input.sdkConfig.model.base_url }
      : {}),
    ...(input.sdkConfig.model.auth_token
      ? { ANTHROPIC_AUTH_TOKEN: input.sdkConfig.model.auth_token }
      : {}),
  };

  try {
    const runResult = await runClaudeCli(args, {
      cwd: input.workspaceDir,
      env,
    });

    if (runResult.aborted) {
      return { text: "", aborted: true, history };
    }

    const parsed = parseClaudeOutput(runResult.stdout);
    const text = extractClaudeText(parsed);

    if (text) {
      history.push({ type: "assistant_text", text, timestamp: Date.now() });
    }
    history.push({ type: "turn_end", timestamp: Date.now() });

    const nextSessionId = extractClaudeSessionId(parsed) ?? state.sessionId;
    if (nextSessionId) {
      await writeState(statePath, { sessionId: nextSessionId });
    }

    return { text, history };
  } finally {
    activeProcess = undefined;
    pendingFollowUps = [];
    await fs.rm(promptPath, { force: true });
  }
}

async function runClaudeCli(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string; aborted: boolean }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      args,
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (isSigtermAbort(error)) {
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", aborted: true });
          return;
        }
        if (error) {
          reject(
            new Error(
              `Claude CLI failed: ${error.message}${stderr ? `\n${stderr}` : ""}`
            )
          );
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", aborted: false });
      }
    );

    activeProcess = child;
  });
}

function parseClaudeOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {};
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i] ?? "{}");
    } catch {
      // Keep scanning lines.
    }
  }

  throw new Error("Claude CLI returned non-JSON output");
}

function extractClaudeText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.result === "string") {
    return record.result;
  }
  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const message = record.message;
  if (message && typeof message === "object") {
    const content = (message as Record<string, unknown>).content;
    const messageText = extractTextFromContent(content);
    if (messageText) return messageText;
  }

  const directContentText = extractTextFromContent(record.content);
  if (directContentText) return directContentText;

  return "";
}

function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const entry = item as Record<string, unknown>;
      if (typeof entry.text === "string") return entry.text;
      return "";
    })
    .filter((part) => part.length > 0)
    .join("\n");
}

function extractClaudeSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.session_id === "string") {
    return record.session_id;
  }
  if (typeof record.sessionId === "string") {
    return record.sessionId;
  }
  if (typeof record.id === "string") {
    return record.id;
  }
  return undefined;
}

function buildPrompt(message: string, followUps: string[]): string {
  if (followUps.length === 0) return message;
  return [message, ...followUps.map((text) => `Follow-up: ${text}`)].join("\n\n");
}

async function readState(statePath: string): Promise<ClaudeRunnerState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as ClaudeRunnerState;
    return typeof parsed.sessionId === "string"
      ? { sessionId: parsed.sessionId }
      : {};
  } catch {
    return {};
  }
}

async function writeState(
  statePath: string,
  state: ClaudeRunnerState
): Promise<void> {
  await fs.writeFile(statePath, JSON.stringify(state), "utf8");
}

function getIpcMessageText(message: unknown): string | undefined {
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && "message" in message) {
    const text = (message as { message?: unknown }).message;
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

function isSigtermAbort(error: Error | null): boolean {
  if (!error) return false;
  const withSignal = error as Error & { signal?: string };
  return withSignal.signal === "SIGTERM";
}
