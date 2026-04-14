import * as childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AgentConfig,
  ContainerConnectorConfig,
  ContainerInput,
  ContainerOutput,
  GatewayConfig,
} from "@aihub/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  buildContainerArgs,
  buildVolumeMounts,
} from "../../agents/container.js";
import { loadConfig } from "../../config/index.js";
import {
  getConnectorPromptsForAgent,
  getConnectorToolsForAgent,
} from "../../connectors/index.js";
import { getDefaultSdkId, getSdkAdapter } from "../registry.js";
import { registerContainerToken, removeContainerToken } from "./tokens.js";
import type {
  HistoryEvent,
  SdkAdapter,
  SdkId,
  SdkRunParams,
  SdkRunResult,
} from "../types.js";

const OUTPUT_START = "---AIHUB_OUTPUT_START---";
const OUTPUT_END = "---AIHUB_OUTPUT_END---";
const EVENT_PREFIX = "---AIHUB_EVENT---";
const DEFAULT_GATEWAY_URL = "http://gateway:4000";
const DEFAULT_TIMEOUT_SECONDS = 300;
const STOP_GRACE_MS = 10_000;

type ContainerSessionHandle = {
  containerName: string;
  ipcDir: string;
};

const historyEventTypes = new Set<HistoryEvent["type"]>([
  "user",
  "assistant_text",
  "assistant_thinking",
  "tool_call",
  "tool_result",
  "turn_end",
  "meta",
  "system_context",
]);

function getArgValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) {
    throw new Error(`Missing docker arg: ${flag}`);
  }
  return value;
}

function parseProtocolOutput(lines: string[]): ContainerOutput | undefined {
  if (!lines.length) return undefined;
  const payload = lines.join("\n").trim();
  if (!payload) return undefined;
  return JSON.parse(payload) as ContainerOutput;
}

function isContainerHandle(handle: unknown): handle is ContainerSessionHandle {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "containerName" in handle &&
    "ipcDir" in handle &&
    typeof handle.containerName === "string" &&
    typeof handle.ipcDir === "string"
  );
}

function assertContainerHandle(handle: unknown): ContainerSessionHandle {
  if (!isContainerHandle(handle)) {
    throw new Error("Invalid container session handle");
  }
  return handle;
}

function writeCloseSentinel(ipcDir: string): void {
  const inputDir = path.join(ipcDir, "input");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, "_close"), "");
}

function execDocker(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    childProcess.execFile("docker", args, { timeout: timeoutMs }, () => {
      resolve();
    });
  });
}

function stopThenKill(containerName: string): void {
  let stopped = false;
  void execDocker(["stop", containerName], STOP_GRACE_MS).finally(() => {
    stopped = true;
  });
  const killTimer = setTimeout(() => {
    if (!stopped) {
      void execDocker(["kill", containerName], 5_000);
    }
  }, STOP_GRACE_MS);
  killTimer.unref?.();
}

function isHistoryEvent(event: unknown): event is HistoryEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof event.type === "string" &&
    historyEventTypes.has(event.type as HistoryEvent["type"])
  );
}

function emitHistory(params: SdkRunParams, output: ContainerOutput): void {
  if (output.history?.length) {
    for (const event of output.history) {
      if (isHistoryEvent(event)) {
        params.onHistoryEvent(event);
      }
    }
    return;
  }

  params.onHistoryEvent({
    type: "user",
    text: params.message,
    timestamp: Date.now(),
  });
  if (output.text) {
    params.onHistoryEvent({
      type: "assistant_text",
      text: output.text,
      timestamp: Date.now(),
    });
  }
  params.onHistoryEvent({ type: "turn_end", timestamp: Date.now() });
}

function buildConnectorConfigs(params: SdkRunParams): ContainerConnectorConfig[] {
  const config = loadConfig();
  const prompts = new Map(
    getConnectorPromptsForAgent(params.agent).map((prompt) => [
      prompt.id,
      prompt.prompt,
    ])
  );
  const connectorConfigs = new Map<string, ContainerConnectorConfig>();

  for (const [id, systemPrompt] of prompts) {
    connectorConfigs.set(id, { id, systemPrompt, tools: [] });
  }

  for (const tool of getConnectorToolsForAgent(params.agent, config)) {
    const connectorId = tool.name.split(".")[0] ?? tool.name;
    const existing = connectorConfigs.get(connectorId);
    const connectorConfig =
      existing ??
      ({
        id: connectorId,
        systemPrompt: prompts.get(connectorId),
        tools: [],
      } satisfies ContainerConnectorConfig);

    connectorConfig.tools.push({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(
        tool.parameters,
        `${tool.name}Parameters`
      ) as Record<string, unknown>,
    });
    connectorConfigs.set(connectorId, connectorConfig);
  }

  return Array.from(connectorConfigs.values());
}

function resolveOnecliProxyUrl(
  config: GatewayConfig,
  agentId: string,
  sandboxOnecliUrl?: string
): string {
  // Top-level onecli has per-agent tokens — use it when available
  const onecli = config.onecli;
  if (onecli) {
    const agentConfig = onecli.agents?.[agentId];
    if (agentConfig?.gatewayToken) {
      const url = new URL(onecli.gatewayUrl);
      url.username = "onecli";
      url.password = agentConfig.gatewayToken;
      return url.toString().replace(/\/$/, "");
    }
    return onecli.gatewayUrl;
  }
  // Fallback to sandbox.onecli.url when no top-level onecli is configured
  return sandboxOnecliUrl ?? "";
}

function buildInput(params: SdkRunParams, agentToken: string): ContainerInput {
  const config = loadConfig();
  const globalSandbox = config.sandbox ?? {};
  const connectorConfigs = buildConnectorConfigs(params);
  return {
    agentId: params.agentId,
    sessionId: params.sessionId,
    userId: params.userId,
    message: params.message,
    attachments: params.attachments,
    thinkLevel: params.thinkLevel,
    context: params.context,
    workspaceDir: "/workspace",
    sessionDir: "/sessions",
    ipcDir: "/workspace/ipc",
    gatewayUrl: config.server?.baseUrl ?? DEFAULT_GATEWAY_URL,
    agentToken,
    onecli: globalSandbox.onecli
      ? {
          enabled: globalSandbox.onecli.enabled ?? true,
          url: resolveOnecliProxyUrl(config, params.agentId, globalSandbox.onecli?.url),
          caPath: "/usr/local/share/ca-certificates/onecli-ca.pem",
        }
      : undefined,
    connectorConfigs: connectorConfigs.length > 0 ? connectorConfigs : undefined,
    sdkConfig: {
      sdk: params.agent.sdk ?? getDefaultSdkId(),
      model: {
        provider: params.agent.model.provider,
        model: params.agent.model.model,
      },
    },
  };
}

export function getContainerAdapter(): SdkAdapter {
  return {
    id: "container" as SdkId,
    displayName: "Container",
    capabilities: {
      queueWhileStreaming: true,
      interrupt: true,
      toolEvents: true,
      fullHistory: true,
    },
    resolveDisplayModel(agent: AgentConfig) {
      const sdkId = (agent.sdk ?? getDefaultSdkId()) as SdkId;
      return getSdkAdapter(sdkId).resolveDisplayModel(agent);
    },
    run(params: SdkRunParams) {
      const config = loadConfig();
      const globalSandbox = config.sandbox ?? {};
      const aihubHome =
        process.env.AIHUB_HOME ?? path.join(os.homedir(), ".aihub");
      const mounts = buildVolumeMounts(
        params.agent,
        globalSandbox,
        aihubHome,
        params.userId
      );
      const args = buildContainerArgs(
        params.agent,
        globalSandbox,
        mounts,
        aihubHome,
        params.userId
      );
      const containerName = getArgValue(args, "--name");
      const ipcDir = path.join(aihubHome, "ipc", params.agentId);
      const ipcInputDir = path.join(ipcDir, "input");
      fs.mkdirSync(ipcInputDir, { recursive: true });

      const agentToken = randomUUID();
      registerContainerToken(agentToken, params.agentId, containerName);
      const input = buildInput(params, agentToken);
      const child = childProcess.spawn("docker", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const handle: ContainerSessionHandle = { containerName, ipcDir };
      params.onSessionHandle?.(handle);

      let stderr = "";
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let stdoutLineBuffer = "";
      const outputLines: string[] = [];
      let inOutputBlock = false;
      let sawStreamingHistory = false;
      const timeoutSeconds =
        params.agent.sandbox?.timeout ?? DEFAULT_TIMEOUT_SECONDS;

      return new Promise<SdkRunResult>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer);
          params.abortSignal.removeEventListener("abort", onAbort);
          removeContainerToken(agentToken);
        };

        const finish = (code: number | null) => {
          if (settled) return;
          settled = true;
          cleanup();

          if (stdoutLineBuffer.length > 0) {
            const line = stdoutLineBuffer.replace(/\r$/, "");
            if (line === OUTPUT_START) {
              inOutputBlock = true;
              outputLines.length = 0;
            } else if (line === OUTPUT_END) {
              inOutputBlock = false;
            } else if (inOutputBlock) {
              outputLines.push(line);
            } else if (line.startsWith(EVENT_PREFIX)) {
              const rawEvent = line.slice(EVENT_PREFIX.length).trim();
              if (rawEvent) {
                try {
                  const event = JSON.parse(rawEvent);
                  if (isHistoryEvent(event)) {
                    sawStreamingHistory = true;
                    params.onHistoryEvent(event);
                    if (event.type === "assistant_text") {
                      params.onEvent({ type: "text", data: event.text });
                    }
                    if (event.type === "assistant_thinking") {
                      params.onEvent({ type: "thinking", data: event.text });
                    }
                  }
                } catch {
                  // ignore malformed stream event lines
                }
              }
            }
          }

          let output: ContainerOutput | undefined;
          try {
            output = parseProtocolOutput(outputLines);
          } catch (error) {
            reject(error);
            return;
          }

          if (!output) {
            if (aborted) {
              resolve({ text: "", aborted: true });
              return;
            }
            const message = timedOut
              ? `Container timed out after ${timeoutSeconds}s`
              : stderr.trim() ||
                `Container exited without protocol output (code ${code ?? "unknown"})`;
            params.onEvent({ type: "error", message });
            reject(new Error(message));
            return;
          }

          if (output.error) {
            params.onEvent({ type: "error", message: output.error });
            reject(new Error(output.error));
            return;
          }

          if (!sawStreamingHistory) {
            emitHistory(params, output);
            if (output.text) {
              params.onEvent({ type: "text", data: output.text });
            }
          }
          resolve({ text: output.text, aborted: output.aborted });
        };

        const onAbort = () => {
          aborted = true;
          writeCloseSentinel(ipcDir);
          stopThenKill(containerName);
        };

        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          stopThenKill(containerName);
        }, timeoutSeconds * 1000);
        timeoutTimer.unref?.();

        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdoutLineBuffer += chunk.toString();
          const lines = stdoutLineBuffer.split("\n");
          stdoutLineBuffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, "");
            if (line === OUTPUT_START) {
              inOutputBlock = true;
              outputLines.length = 0;
              continue;
            }
            if (line === OUTPUT_END) {
              inOutputBlock = false;
              continue;
            }
            if (inOutputBlock) {
              outputLines.push(line);
              continue;
            }
            if (!line.startsWith(EVENT_PREFIX)) {
              continue;
            }

            const rawEvent = line.slice(EVENT_PREFIX.length).trim();
            if (!rawEvent) continue;

            try {
              const event = JSON.parse(rawEvent);
              if (!isHistoryEvent(event)) {
                continue;
              }
              sawStreamingHistory = true;
              params.onHistoryEvent(event);
              if (event.type === "assistant_text") {
                params.onEvent({ type: "text", data: event.text });
              }
              if (event.type === "assistant_thinking") {
                params.onEvent({ type: "thinking", data: event.text });
              }
            } catch {
              // ignore malformed stream event lines
            }
          }
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        });
        child.once("close", finish);
        child.once("exit", finish);

        if (params.abortSignal.aborted) {
          onAbort();
        } else {
          params.abortSignal.addEventListener("abort", onAbort, { once: true });
        }

        child.stdin?.end(`${JSON.stringify(input)}\n`);
      });
    },
    async queueMessage(handle: unknown, message: string) {
      const { ipcDir } = assertContainerHandle(handle);
      const inputDir = path.join(ipcDir, "input");
      const timestamp = Date.now();
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(
        path.join(inputDir, `${timestamp}.json`),
        JSON.stringify({ message, timestamp })
      );
    },
    abort(handle: unknown) {
      const { containerName, ipcDir } = assertContainerHandle(handle);
      writeCloseSentinel(ipcDir);
      stopThenKill(containerName);
    },
  };
}
