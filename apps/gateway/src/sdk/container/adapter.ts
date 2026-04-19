import * as childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentConfig,
  ContainerConnectorConfig,
  ContainerInput,
  ContainerOutput,
  FileAttachment,
  GatewayConfig,
} from "@aihub/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  buildContainerArgs,
  buildVolumeMounts,
  CONTAINER_DATA_DIR,
  CONTAINER_UPLOADS_DIR,
  getAgentDataDir,
  getSessionUploadsDir,
  getMountedOnecliCaPath,
} from "../../agents/container.js";
import { loadConfig } from "../../config/index.js";
import {
  getConnectorPromptsForAgent,
  getConnectorToolGroupsForAgent,
} from "../../connectors/index.js";
import { ensureBootstrapFiles } from "../../agents/workspace.js";
import {
  ensureMediaDirectories,
  getMediaInboundDir,
  getMediaOutboundDir,
  registerMediaFile,
} from "../../media/metadata.js";
import { getDefaultSdkId, getSdkAdapter } from "../registry.js";
import { registerContainerToken, removeContainerToken } from "./tokens.js";
import {
  appendAttachmentContext,
  buildDocumentAttachmentContext,
} from "../attachments.js";
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
const DEFAULT_GATEWAY_PORT = 4000;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;
const DEFAULT_MAX_RUNTIME_SECONDS = 1800;
const BENIGN_STDERR_PATTERNS = [
  /^\[agent-runner\] Running agent .+ with SDK .+$/,
];

function resolveContainerGatewayUrl(config: GatewayConfig): string {
  if (config.server?.baseUrl) return config.server.baseUrl;
  const envPort = Number(process.env.AIHUB_GATEWAY_PORT);
  const port =
    Number.isFinite(envPort) && envPort > 0
      ? envPort
      : (config.gateway?.port ?? DEFAULT_GATEWAY_PORT);
  return `http://host.docker.internal:${port}`;
}
const STOP_GRACE_MS = 10_000;

type ContainerSessionHandle = {
  containerName: string;
  ipcDir: string;
  recordQueuedMessageActivity?: () => void;
};

function hasReadableDocumentAttachment(params: SdkRunParams): boolean {
  return (
    params.attachments?.some(
      (attachment) =>
        !attachment.mimeType.startsWith("image/") &&
        fs.existsSync(attachment.path)
    ) ?? false
  );
}

const historyEventTypes = new Set<HistoryEvent["type"]>([
  "user",
  "assistant_text",
  "assistant_thinking",
  "assistant_file",
  "tool_call",
  "tool_result",
  "turn_end",
  "meta",
  "system_context",
]);

type RawFileOutputEvent = {
  type: "file_output";
  path: string;
  filename?: string;
  mimeType?: string;
  size?: number;
};

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

function getMeaningfulStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter(
      (line) =>
        !BENIGN_STDERR_PATTERNS.some((pattern) => pattern.test(line.trim()))
    )
    .join("\n")
    .trim();
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

function isRawFileOutputEvent(event: unknown): event is RawFileOutputEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "file_output" &&
    "path" in event &&
    typeof event.path === "string"
  );
}

function sanitizeFilename(
  filename: string | undefined,
  fallback: string
): string {
  if (!filename) return fallback;
  const cleaned = filename
    .replace(/\0/g, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  return cleaned?.replace(/["\\\r\n]/g, "_") || fallback;
}

function resolveContainerDataFile(
  hostDataDir: string,
  containerPath: string
): string {
  const normalized = path.posix.normalize(containerPath);
  const relative = path.posix.relative(CONTAINER_DATA_DIR, normalized);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.posix.isAbsolute(relative)
  ) {
    throw new Error(`file_output path must be under ${CONTAINER_DATA_DIR}`);
  }
  return path.join(hostDataDir, ...relative.split("/"));
}

function ensurePathWithinDir(filePath: string, dir: string): void {
  const relative = path.relative(dir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside expected directory: ${filePath}`);
  }
}

function prepareContainerUploads(
  params: SdkRunParams,
  uploadsDir: string
): void {
  fs.rmSync(uploadsDir, { recursive: true, force: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  if (!params.attachments?.length) return;

  const realInboundDir = fs.realpathSync(getMediaInboundDir());
  params.attachments.forEach((attachment, index) => {
    copyUploadAttachment(attachment, index, realInboundDir, uploadsDir);
  });
}

function copyUploadAttachment(
  attachment: FileAttachment,
  index: number,
  realInboundDir: string,
  uploadsDir: string
): void {
  const source = fs.realpathSync(attachment.path);
  ensurePathWithinDir(source, realInboundDir);
  const safeName = sanitizeFilename(
    attachment.filename ?? path.basename(source),
    path.basename(source)
  );
  const target = path.join(uploadsDir, `${index + 1}-${safeName}`);
  fs.copyFileSync(source, target);
}

async function handleFileOutputEvent(
  params: SdkRunParams,
  event: RawFileOutputEvent,
  hostDataDir: string
): Promise<void> {
  const source = resolveContainerDataFile(hostDataDir, event.path);
  const realDataDir = await fsPromises.realpath(hostDataDir);
  const realSource = await fsPromises.realpath(source);
  ensurePathWithinDir(realSource, realDataDir);

  const stat = await fsPromises.stat(realSource);
  if (!stat.isFile()) {
    throw new Error(`file_output path is not a file: ${event.path}`);
  }

  const filename = sanitizeFilename(
    event.filename,
    path.basename(realSource) || "download"
  );
  const ext = path.extname(filename);
  const fileId = randomUUID();
  const storedFilename = `${fileId}${ext}`;
  const target = path.join(getMediaOutboundDir(), storedFilename);
  const mimeType = event.mimeType || "application/octet-stream";

  await ensureMediaDirectories();
  await fsPromises.copyFile(realSource, target);
  const metadata = await registerMediaFile({
    direction: "outbound",
    fileId,
    filename,
    storedFilename,
    path: target,
    mimeType,
    size: stat.size,
    agentId: params.agentId,
    sessionId: params.sessionId,
  });

  const timestamp = Date.now();
  params.onHistoryEvent({
    type: "assistant_file",
    fileId: metadata.fileId,
    filename: metadata.filename,
    mimeType: metadata.mimeType,
    size: metadata.size,
    direction: "outbound",
    timestamp,
  });
  params.onEvent({
    type: "file_output",
    fileId: metadata.fileId,
    filename: metadata.filename,
    mimeType: metadata.mimeType,
    size: metadata.size,
  });
}

function forwardStreamEvent(params: SdkRunParams, event: HistoryEvent): void {
  if (event.type === "assistant_text") {
    params.onEvent({ type: "text", data: event.text });
    return;
  }
  if (event.type === "assistant_thinking") {
    params.onEvent({ type: "thinking", data: event.text });
    return;
  }
  if (event.type === "assistant_file") {
    params.onEvent({
      type: "file_output",
      fileId: event.fileId,
      filename: event.filename,
      mimeType: event.mimeType,
      size: event.size,
    });
    return;
  }
  if (event.type === "tool_call") {
    params.onEvent({ type: "tool_start", toolName: event.name });
    params.onEvent({
      type: "tool_call",
      id: event.id,
      name: event.name,
      arguments: event.args,
    });
    return;
  }
  if (event.type === "tool_result") {
    params.onEvent({
      type: "tool_end",
      toolName: event.name,
      isError: event.isError,
    });
    params.onEvent({
      type: "tool_result",
      id: event.id,
      name: event.name,
      content: event.content,
      isError: event.isError,
      details: event.details,
    });
    return;
  }
}

function emitHistory(params: SdkRunParams, output: ContainerOutput): void {
  if (output.history?.length) {
    for (const event of output.history) {
      if (isHistoryEvent(event) && event.type !== "user") {
        params.onHistoryEvent(event);
      }
    }
    return;
  }

  if (output.text) {
    params.onHistoryEvent({
      type: "assistant_text",
      text: output.text,
      timestamp: Date.now(),
    });
  }
  params.onHistoryEvent({ type: "turn_end", timestamp: Date.now() });
}

function buildConnectorConfigs(
  params: SdkRunParams
): ContainerConnectorConfig[] {
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

  for (const group of getConnectorToolGroupsForAgent(params.agent, config)) {
    const existing = connectorConfigs.get(group.connectorId);
    const connectorConfig =
      existing ??
      ({
        id: group.connectorId,
        systemPrompt: prompts.get(group.connectorId),
        tools: [],
      } satisfies ContainerConnectorConfig);

    for (const tool of group.tools) {
      connectorConfig.tools.push({
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(
          tool.parameters,
          `${tool.name}Parameters`
        ) as Record<string, unknown>,
      });
    }
    connectorConfigs.set(group.connectorId, connectorConfig);
  }

  return Array.from(connectorConfigs.values());
}

function attachExtraNetwork(containerName: string, network: string): void {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      childProcess.execFileSync(
        "docker",
        ["network", "connect", network, containerName],
        { stdio: "pipe" }
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists|endpoint with name/.test(msg)) return;
      if (/No such container/.test(msg)) {
        // container not yet running; brief retry
        const until = Date.now() + 100;
        while (Date.now() < until) {
          /* spin */
        }
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Failed to connect container ${containerName} to network ${network}`
  );
}

function resolveOnecliProxyUrl(
  config: GatewayConfig,
  agentId: string
): string | undefined {
  const onecli = config.onecli;
  if (!onecli?.enabled || !onecli.gatewayUrl) return undefined;
  const agent = config.agents.find((a) => a.id === agentId);
  const base = onecli.sandbox?.url ?? onecli.gatewayUrl;
  const url = new URL(base);
  if (!onecli.sandbox?.url) {
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      url.hostname = "host.docker.internal";
    }
  }
  if (agent?.onecliToken) {
    url.username = "onecli";
    url.password = agent.onecliToken;
  }
  return url.toString().replace(/\/$/, "");
}

function remapAttachmentsToContainer(
  attachments: FileAttachment[] | undefined
): FileAttachment[] | undefined {
  if (!attachments?.length) return attachments;
  return attachments.map((attachment, index) => {
    const safeName = sanitizeFilename(
      attachment.filename ?? path.basename(attachment.path),
      path.basename(attachment.path)
    );
    return {
      ...attachment,
      path: path.join(CONTAINER_UPLOADS_DIR, `${index + 1}-${safeName}`),
    };
  });
}

function buildInput(params: SdkRunParams, agentToken: string): ContainerInput {
  const config = loadConfig();
  const connectorConfigs = buildConnectorConfigs(params);
  return {
    agentId: params.agentId,
    sessionId: params.sessionId,
    userId: params.userId,
    message: params.message,
    attachments: remapAttachmentsToContainer(params.attachments),
    thinkLevel: params.thinkLevel,
    context: params.context,
    workspaceDir: "/workspace",
    sessionDir: "/sessions",
    ipcDir: "/workspace/ipc",
    gatewayUrl: resolveContainerGatewayUrl(config),
    agentToken,
    onecli:
      config.onecli?.enabled && config.onecli.gatewayUrl
        ? {
            enabled: true,
            url:
              resolveOnecliProxyUrl(config, params.agentId) ??
              config.onecli.gatewayUrl,
            caPath: getMountedOnecliCaPath(config.onecli),
          }
        : undefined,
    connectorConfigs:
      connectorConfigs.length > 0 ? connectorConfigs : undefined,
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
    async run(params: SdkRunParams) {
      const config = loadConfig();
      const globalSandbox = config.sandbox ?? {};
      const aihubHome =
        process.env.AIHUB_HOME ?? path.join(os.homedir(), ".aihub");
      const mounts = buildVolumeMounts(
        params.agent,
        globalSandbox,
        aihubHome,
        params.userId,
        config.onecli,
        params.sessionId
      );
      const args = buildContainerArgs(
        params.agent,
        globalSandbox,
        mounts,
        aihubHome,
        params.userId,
        config.onecli
      );
      const containerName = getArgValue(args, "--name");
      const ipcDir = path.join(aihubHome, "ipc", params.agentId);
      const ipcInputDir = path.join(ipcDir, "input");
      const hostDataDir = getAgentDataDir(aihubHome, params.agentId);
      const hostUploadsDir = getSessionUploadsDir(
        aihubHome,
        params.agentId,
        params.sessionId
      );
      // Wipe stale IPC files from prior container runs so they don't leak into
      // this run's follow-up queue (e.g. old "/stop" getting delivered to new session).
      fs.rmSync(ipcInputDir, { recursive: true, force: true });
      fs.mkdirSync(ipcInputDir, { recursive: true });
      fs.mkdirSync(path.join(aihubHome, "sessions", params.agentId), {
        recursive: true,
      });
      if (params.userId) {
        fs.mkdirSync(path.join(aihubHome, "users", params.userId), {
          recursive: true,
        });
      }
      prepareContainerUploads(params, hostUploadsDir);
      await ensureBootstrapFiles(params.workspaceDir);

      const agentToken = randomUUID();
      registerContainerToken(agentToken, params.agentId, containerName);
      const attachmentContext = hasReadableDocumentAttachment(params)
        ? await buildDocumentAttachmentContext(params.attachments)
        : "";
      const input = buildInput(
        {
          ...params,
          message: appendAttachmentContext(params.message, attachmentContext),
        },
        agentToken
      );
      const child = childProcess.spawn("docker", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const extraNetwork = config.onecli?.sandbox?.network;
      if (extraNetwork) {
        attachExtraNetwork(containerName, extraNetwork);
      }
      let stderr = "";
      let timeoutKind: "idle" | "max" | undefined;
      let aborted = false;
      let settled = false;
      let stdoutLineBuffer = "";
      const outputLines: string[] = [];
      let inOutputBlock = false;
      let sawStreamingHistory = false;
      const pendingFileOutputs: Promise<void>[] = [];
      const idleTimeoutSeconds =
        params.agent.sandbox?.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_SECONDS;
      const maxRunTimeSeconds =
        params.agent.sandbox?.maxRunTime ??
        params.agent.sandbox?.timeout ??
        DEFAULT_MAX_RUNTIME_SECONDS;
      let lastActivityAt = Date.now();
      let lastActivityType = "container_start";
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let maxRunTimeTimer: ReturnType<typeof setTimeout> | undefined;

      return new Promise<SdkRunResult>((resolve, reject) => {
        const cleanup = () => {
          if (idleTimer) clearTimeout(idleTimer);
          if (maxRunTimeTimer) clearTimeout(maxRunTimeTimer);
          params.abortSignal.removeEventListener("abort", onAbort);
          removeContainerToken(agentToken);
        };

        const describeLastActivity = (): string => {
          const ageSeconds = Math.max(0, Math.round((Date.now() - lastActivityAt) / 1000));
          return `last activity was ${lastActivityType} ${ageSeconds}s ago`;
        };

        const stopForTimeout = (kind: "idle" | "max"): void => {
          if (timeoutKind || settled) return;
          timeoutKind = kind;
          stopThenKill(containerName);
        };

        const resetIdleTimer = (): void => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            stopForTimeout("idle");
          }, idleTimeoutSeconds * 1000);
          idleTimer.unref?.();
        };

        const recordActivity = (type: string): void => {
          if (settled || timeoutKind) return;
          lastActivityAt = Date.now();
          lastActivityType = type;
          resetIdleTimer();
        };

        const handle: ContainerSessionHandle = {
          containerName,
          ipcDir,
          recordQueuedMessageActivity: () => recordActivity("queued_user_message"),
        };
        params.onSessionHandle?.(handle);

        // Emit user event immediately so active-turn state is populated before
        // the container starts streaming assistant events.
        params.onHistoryEvent({
          type: "user",
          text: params.message,
          attachments: params.attachments,
          timestamp: Date.now(),
        });

        const handleProtocolEvent = (rawEvent: string): void => {
          if (!rawEvent) return;

          try {
            const event = JSON.parse(rawEvent);
            if (isHistoryEvent(event)) {
              recordActivity(`history_${event.type}`);
              sawStreamingHistory = true;
              params.onHistoryEvent(event);
              forwardStreamEvent(params, event);
              return;
            }
            if (isRawFileOutputEvent(event)) {
              recordActivity("file_output");
              const task = handleFileOutputEvent(
                params,
                event,
                hostDataDir
              ).catch((error) => {
                const message =
                  error instanceof Error ? error.message : String(error);
                params.onEvent({ type: "error", message });
              });
              pendingFileOutputs.push(task);
            }
          } catch {
            // ignore malformed stream event lines
          }
        };

        const finish = async (code: number | null) => {
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
              handleProtocolEvent(line.slice(EVENT_PREFIX.length).trim());
            }
          }

          await Promise.all(pendingFileOutputs);

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
            const meaningfulStderr = getMeaningfulStderr(stderr);
            const message = timeoutKind
              ? timeoutKind === "idle"
                ? `Container idle timed out after ${idleTimeoutSeconds}s without activity; ${describeLastActivity()}`
                : `Container exceeded max runtime after ${maxRunTimeSeconds}s; ${describeLastActivity()}`
              : meaningfulStderr ||
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

        resetIdleTimer();
        maxRunTimeTimer = setTimeout(() => {
          stopForTimeout("max");
        }, maxRunTimeSeconds * 1000);
        maxRunTimeTimer.unref?.();

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

            handleProtocolEvent(rawEvent);
          }
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          const text = chunk.toString();
          stderr += text;
          console.error(`[container:${params.agentId}] ${text.trimEnd()}`);
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
      const { ipcDir, recordQueuedMessageActivity } = assertContainerHandle(handle);
      const inputDir = path.join(ipcDir, "input");
      const timestamp = Date.now();
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(
        path.join(inputDir, `${timestamp}.json`),
        JSON.stringify({ message, timestamp })
      );
      recordQueuedMessageActivity?.();
    },
    abort(handle: unknown) {
      const { containerName, ipcDir } = assertContainerHandle(handle);
      writeCloseSentinel(ipcDir);
      stopThenKill(containerName);
    },
  };
}
