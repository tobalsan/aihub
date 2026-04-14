import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContainerInput } from "@aihub/shared";
import { runAgent, sendFollowUpMessage } from "../runner.js";

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
  DefaultResourceLoader: vi.fn(function (this: {
    reload: () => Promise<void>;
  }) {
    this.reload = piMock.resourceReload;
  }),
  createAgentSession: piMock.createAgentSession,
  createCodingTools: piMock.createCodingTools,
}));

afterEach(() => {
  piMock.reset();
});

describe("Pi runner", () => {
  it("runs the Pi session and returns history events", async () => {
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

    const output = await runAgent(createInput({ workspaceDir, sessionDir }));

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
    expect(piMock.setRuntimeApiKey).toHaveBeenCalledWith(
      "anthropic",
      "onecli-proxy-managed"
    );
    expect(piMock.createCodingTools).toHaveBeenCalledWith(workspaceDir);
    expect(piMock.session.dispose).toHaveBeenCalledTimes(1);

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
    sdkConfig: {
      sdk: "pi",
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      },
    },
  };
}
