import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContainerInput } from "@aihub/shared";
import { runAgent, sendFollowUpMessage } from "../runner.js";

const proxyFetchMock = vi.hoisted(() => vi.fn());

const piMock = vi.hoisted(() => {
  const subscribers: Array<(event: unknown) => void> = [];
  const setRuntimeApiKey = vi.fn();
  const model = {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    model: "claude-sonnet-4-6",
  };
  const session = {
    messages: [] as unknown[],
    subscribe: vi.fn((listener: (event: unknown) => void) => {
      subscribers.push(listener);
      return vi.fn();
    }),
    prompt: vi.fn(async () => undefined),
    sendUserMessage: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };

  return {
    subscribers,
    setRuntimeApiKey,
    model,
    session,
    createAgentSession: vi.fn(async () => ({ session })),
    createCodingTools: vi.fn(() => []),
    resourceReload: vi.fn(async () => undefined),
    reset() {
      subscribers.length = 0;
      session.messages = [];
      session.subscribe.mockClear();
      session.prompt.mockReset();
      session.prompt.mockResolvedValue(undefined);
      session.sendUserMessage.mockClear();
      session.abort.mockClear();
      session.dispose.mockClear();
      this.createAgentSession.mockClear();
      this.createCodingTools.mockClear();
      this.resourceReload.mockClear();
      setRuntimeApiKey.mockClear();
    },
  };
});

vi.mock("../proxy.js", () => ({
  proxyClient: {
    fetch: proxyFetchMock,
  },
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: {
    inMemory: vi.fn(() => ({
      setRuntimeApiKey: piMock.setRuntimeApiKey,
    })),
  },
  ModelRegistry: {
    create: vi.fn(() => ({
      find: vi.fn(() => piMock.model),
    })),
  },
  SessionManager: {
    open: vi.fn(() => ({})),
  },
  SettingsManager: {
    create: vi.fn(() => ({})),
  },
  DefaultResourceLoader: vi.fn(function (
    this: {
      reload: () => Promise<void>;
      options?: unknown;
    },
    options: unknown
  ) {
    this.reload = piMock.resourceReload;
    this.options = options;
  }),
  createAgentSession: piMock.createAgentSession,
  createCodingTools: piMock.createCodingTools,
}));

afterEach(() => {
  piMock.reset();
  proxyFetchMock.mockReset();
});

describe("Pi runner", () => {
  it("runs the Pi session, returns history events, and streams events", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-runner-"));
    const workspaceDir = path.join(tempDir, "workspace");
    const sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "agent docs");

    piMock.session.prompt.mockImplementationOnce(async () => {
      const assistant = {
        role: "assistant",
        content: [{ type: "text", text: "hello from pi" }],
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        api: "messages",
        usage: { inputTokens: 1, outputTokens: 2 },
        stopReason: "end_turn",
      };

      for (const subscriber of piMock.subscribers) {
        subscriber({
          type: "message_update",
          message: assistant,
          assistantMessageEvent: { type: "text_delta", delta: "hello" },
        });
        subscriber({
          type: "tool_execution_start",
          toolCallId: "tool-1",
          toolName: "bash",
          args: { cmd: "pwd" },
        });
        subscriber({
          type: "tool_execution_end",
          toolCallId: "tool-1",
          toolName: "bash",
          result: { content: [{ type: "text", text: workspaceDir }] },
          isError: false,
        });
        subscriber({ type: "message_end", message: assistant });
      }
      piMock.session.messages.push(assistant);
    });

    const streamedEvents: unknown[] = [];
    const output = await runAgent(
      createInput({ workspaceDir, sessionDir }),
      (event) => {
        streamedEvents.push(event);
      }
    );

    expect(output.text).toBe("hello from pi");
    expect(
      output.history?.map((event) => (event as { type: string }).type)
    ).toEqual([
      "user",
      "assistant_text",
      "tool_call",
      "tool_result",
      "meta",
      "turn_end",
    ]);
    expect(
      streamedEvents.map((event) => (event as { type: string }).type)
    ).toEqual([
      "assistant_text",
      "tool_call",
      "tool_result",
      "meta",
      "turn_end",
    ]);
    expect(piMock.setRuntimeApiKey).toHaveBeenCalledWith(
      "anthropic",
      "onecli-proxy-managed"
    );
    expect(piMock.createCodingTools).toHaveBeenCalledWith(workspaceDir);
    expect(piMock.session.dispose).toHaveBeenCalledTimes(1);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("registers connector tools from connectorConfigs", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-runner-"));
    const workspaceDir = path.join(tempDir, "workspace");
    const sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    proxyFetchMock.mockResolvedValue(
      Response.json({ ok: true, value: 42 }, { status: 200 })
    );

    piMock.session.prompt.mockImplementationOnce(async () => {
      piMock.session.messages.push({
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      });
    });

    await runAgent(
      createInput({
        workspaceDir,
        sessionDir,
        connectorConfigs: [
          {
            id: "github",
            systemPrompt: "Use GitHub tools first.",
            tools: [
              {
                name: "github.search",
                description: "Search GitHub",
                parameters: {
                  type: "object",
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
              },
            ],
          },
        ],
      })
    );

    const createAgentSessionCalls = piMock.createAgentSession.mock
      .calls as unknown as Array<[
      {
        customTools: Array<{
          name: string;
          execute: (_id: string, args: unknown) => Promise<unknown>;
        }>;
        resourceLoader: {
          options?: {
            agentsFilesOverride?: () => {
              agentsFiles: Array<{ path: string; content: string }>;
            };
          };
        };
      },
    ]>;
    const createAgentSessionArgs = createAgentSessionCalls[0]?.[0];
    if (!createAgentSessionArgs) {
      throw new Error("createAgentSession was not called");
    }
    const connectorTool = createAgentSessionArgs.customTools.find(
      (tool) => tool.name === "github.search"
    );

    expect(connectorTool).toBeDefined();

    await connectorTool?.execute("tool-1", { query: "aihub" });
    expect(proxyFetchMock).toHaveBeenCalledWith(
      "http://onecli/connectors/tools",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-id": "agent-1",
        },
        body: JSON.stringify({
          connectorId: "github",
          tool: "github.search",
          args: { query: "aihub" },
        }),
      })
    );

    const contextFiles =
      createAgentSessionArgs.resourceLoader.options?.agentsFilesOverride?.()
        .agentsFiles ?? [];
    expect(contextFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "CONNECTOR_github.md",
          content: "Use GitHub tools first.",
        }),
      ])
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("steers follow-up IPC messages into the active session", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-runner-"));
    const workspaceDir = path.join(tempDir, "workspace");
    const sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    piMock.session.prompt.mockImplementationOnce(async () => {
      await sendFollowUpMessage({ message: "keep going" });
      piMock.session.messages.push({
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      });
    });

    await runAgent(createInput({ workspaceDir, sessionDir }));

    expect(piMock.session.sendUserMessage).toHaveBeenCalledWith("keep going", {
      deliverAs: "steer",
    });

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("queues IPC messages received before the Pi session is ready", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-runner-"));
    const workspaceDir = path.join(tempDir, "workspace");
    const sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });
    await sendFollowUpMessage({ message: "already queued" });

    piMock.session.prompt.mockImplementationOnce(async () => {
      piMock.session.messages.push({
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      });
    });

    await runAgent(createInput({ workspaceDir, sessionDir }));

    expect(piMock.session.sendUserMessage).toHaveBeenCalledWith(
      "already queued",
      { deliverAs: "steer" }
    );

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

function createInput(paths: {
  workspaceDir: string;
  sessionDir: string;
  connectorConfigs?: ContainerInput["connectorConfigs"];
}): ContainerInput {
  return {
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    workspaceDir: paths.workspaceDir,
    sessionDir: paths.sessionDir,
    ipcDir: "/ipc",
    gatewayUrl: "http://gateway:3000",
    agentToken: "token-1",
    connectorConfigs: paths.connectorConfigs,
    sdkConfig: {
      sdk: "pi",
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      },
    },
  };
}
