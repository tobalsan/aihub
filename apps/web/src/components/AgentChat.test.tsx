// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { AgentChat, __resetAgentChatStateForTests } from "./AgentChat";

const {
  fetchFullHistoryMock,
  fetchSubagentsMock,
  fetchSubagentLogsMock,
  getSessionKeyMock,
  spawnSubagentMock,
  streamMessageMock,
  subscribeToSessionMock,
  uploadFilesMock,
  interruptSubagentMock,
  killSubagentMock,
  archiveSubagentMock,
} = vi.hoisted(() => ({
  fetchFullHistoryMock: vi.fn(),
  fetchSubagentsMock: vi.fn(),
  fetchSubagentLogsMock: vi.fn(),
  getSessionKeyMock: vi.fn(),
  spawnSubagentMock: vi.fn(),
  streamMessageMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
  uploadFilesMock: vi.fn(),
  interruptSubagentMock: vi.fn(),
  killSubagentMock: vi.fn(),
  archiveSubagentMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchFullHistory: fetchFullHistoryMock,
  fetchSubagents: fetchSubagentsMock,
  fetchSubagentLogs: fetchSubagentLogsMock,
  getSessionKey: getSessionKeyMock,
  spawnSubagent: spawnSubagentMock,
  streamMessage: streamMessageMock,
  subscribeToSession: subscribeToSessionMock,
  uploadFiles: uploadFilesMock,
  interruptSubagent: interruptSubagentMock,
  killSubagent: killSubagentMock,
  archiveSubagent: archiveSubagentMock,
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderLead() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <AgentChat
        agentId="lead-1"
        agentName="Lead"
        agentType="lead"
        onBack={() => {}}
      />
    ),
    container
  );
  return { container, dispose };
}

function renderSubagent(status: "running" | "idle" = "idle") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <AgentChat
        agentId={null}
        agentName="Worker"
        agentType="subagent"
        subagentInfo={{
          projectId: "PRO-1",
          slug: "worker-1",
          cli: "codex",
          runMode: "clone",
          status,
        }}
        onBack={() => {}}
      />
    ),
    container
  );
  return { container, dispose };
}

describe("AgentChat stop/send behavior", () => {
  beforeEach(() => {
    __resetAgentChatStateForTests();
    delegateEvents(["click", "input", "keydown"]);
    fetchFullHistoryMock.mockResolvedValue({ messages: [] });
    fetchSubagentsMock.mockResolvedValue({ ok: true, data: { items: [] } });
    fetchSubagentLogsMock.mockResolvedValue({
      ok: true,
      data: { cursor: 0, events: [] },
    });
    getSessionKeyMock.mockReturnValue("main");
    spawnSubagentMock.mockResolvedValue({
      ok: true,
      data: { slug: "worker-1" },
    });
    streamMessageMock.mockImplementation(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        _onText: (text: string) => void,
        _onDone: () => void,
        _onError: (error: string) => void
      ) =>
        () => {}
    );
    subscribeToSessionMock.mockImplementation(() => () => {});
    uploadFilesMock.mockResolvedValue([]);
    interruptSubagentMock.mockResolvedValue({
      ok: true,
      data: { slug: "worker-1" },
    });
    killSubagentMock.mockResolvedValue({
      ok: true,
      data: { slug: "worker-1" },
    });
    archiveSubagentMock.mockResolvedValue({
      ok: true,
      data: { slug: "worker-1", archived: true },
    });
  });

  afterEach(() => {
    __resetAgentChatStateForTests();
    vi.useRealTimers();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows Stop when subagent status is running", async () => {
    const { container, dispose } = renderSubagent("running");
    await tick();

    expect(container.querySelector(".stop-btn")).not.toBeNull();
    expect(container.querySelector(".send-btn")).toBeNull();

    dispose();
  });

  it("includes cache tokens in lead context usage estimate", async () => {
    fetchFullHistoryMock.mockResolvedValue({
      messages: [
        {
          role: "assistant",
          timestamp: Date.now(),
          content: [{ type: "text", text: "done" }],
          meta: {
            model: "claude-3-5-sonnet",
            usage: {
              input: 1000,
              output: 50,
              cacheRead: 39000,
              cacheWrite: 0,
              totalTokens: 40050,
            },
          },
        },
      ],
    });

    const { container, dispose } = renderLead();
    await tick();
    await tick();

    expect(container.querySelector(".context-usage")?.textContent).toContain(
      "~20% context used"
    );

    dispose();
  });

  it("shows lead context warning at 80% or higher", async () => {
    fetchFullHistoryMock.mockResolvedValue({
      messages: [
        {
          role: "assistant",
          timestamp: Date.now(),
          content: [{ type: "text", text: "done" }],
          meta: {
            model: "claude-3-5-sonnet",
            usage: {
              input: 160000,
              output: 50,
              totalTokens: 160050,
            },
          },
        },
      ],
    });

    const { container, dispose } = renderLead();
    await tick();
    await tick();

    expect(container.querySelector(".context-warning")?.textContent).toContain(
      "Context usage is high (~80%)"
    );
    expect(container.querySelector(".context-warning")?.textContent).toContain(
      "creating a handoff document"
    );

    dispose();
  });

  it("renders subagent context usage percent from latest estimate", async () => {
    fetchSubagentLogsMock.mockResolvedValueOnce({
      ok: true,
      data: {
        cursor: 1,
        events: [],
        latestContextEstimate: {
          usedTokens: 60000,
          maxTokens: 200000,
          pct: 30,
          basis: "claude_prompt_tokens",
          available: true,
        },
      },
    });

    const { container, dispose } = renderSubagent("idle");
    await tick();
    await tick();

    expect(container.querySelector(".context-usage")?.textContent).toContain(
      "~30% context used"
    );

    dispose();
  });

  it("shows subagent context warning when estimate is high", async () => {
    fetchSubagentLogsMock.mockResolvedValueOnce({
      ok: true,
      data: {
        cursor: 1,
        events: [],
        latestContextEstimate: {
          usedTokens: 170000,
          maxTokens: 200000,
          pct: 85,
          basis: "claude_prompt_tokens",
          available: true,
        },
      },
    });

    const { container, dispose } = renderSubagent("idle");
    await tick();
    await tick();

    expect(container.querySelector(".context-warning")?.textContent).toContain(
      "Context usage is high (~85%)"
    );

    dispose();
  });

  it("renders subagent context usage unavailable when estimate is unavailable", async () => {
    fetchSubagentLogsMock.mockResolvedValueOnce({
      ok: true,
      data: {
        cursor: 1,
        events: [],
        latestContextEstimate: {
          usedTokens: 0,
          maxTokens: 200000,
          pct: 0,
          basis: "codex_cumulative",
          available: false,
          reason: "codex_cumulative_only",
        },
      },
    });

    const { container, dispose } = renderSubagent("idle");
    await tick();
    await tick();

    expect(container.querySelector(".context-usage")?.textContent).toContain(
      "Context usage unavailable"
    );

    dispose();
  });

  it("hides context usage when no estimate is available yet", async () => {
    const { container, dispose } = renderSubagent("idle");
    await tick();
    await tick();

    expect(container.querySelector(".context-usage")).toBeNull();
    expect(container.querySelector(".context-warning")).toBeNull();

    dispose();
  });

  it("shows Stop while subagent message is sending", async () => {
    spawnSubagentMock.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>
    );
    const { container, dispose } = renderSubagent("idle");
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(container.querySelector(".stop-btn")).not.toBeNull();

    dispose();
  });

  it("keeps Stop visible after spawn resolves while awaiting response", async () => {
    const { container, dispose } = renderSubagent("idle");
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await tick();
    await tick();

    expect(container.querySelector(".stop-btn")).not.toBeNull();
    expect(container.querySelector(".send-btn")).toBeNull();
    expect(
      (container.querySelector("textarea") as HTMLTextAreaElement).disabled
    ).toBe(true);

    dispose();
  });

  it("keeps loading spinner through session events until real response arrives", async () => {
    vi.useFakeTimers();
    fetchSubagentLogsMock
      .mockResolvedValueOnce({
        ok: true,
        data: { cursor: 0, events: [] },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 1,
          events: [
            { type: "session", text: "session started" },
            { type: "user", text: "hello" },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 2,
          events: [{ type: "assistant", text: "on it" }],
        },
      });

    const { container, dispose } = renderSubagent("idle");
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).toBeNull();

    dispose();
    vi.useRealTimers();
  });

  it("keeps loading spinner through message events until real response arrives", async () => {
    vi.useFakeTimers();
    fetchSubagentLogsMock
      .mockResolvedValueOnce({
        ok: true,
        data: { cursor: 0, events: [] },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 1,
          events: [
            { type: "message", text: "internal event" },
            { type: "user", text: "hello" },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 2,
          events: [{ type: "assistant", text: "on it" }],
        },
      });

    const { container, dispose } = renderSubagent("idle");
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).toBeNull();

    dispose();
    vi.useRealTimers();
  });

  it("keeps loading spinner when assistant events are empty", async () => {
    vi.useFakeTimers();
    fetchSubagentLogsMock
      .mockResolvedValueOnce({
        ok: true,
        data: { cursor: 0, events: [] },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 1,
          events: [
            { type: "user", text: "hello" },
            { type: "assistant", text: "" },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 2,
          events: [{ type: "assistant", text: "done" }],
        },
      });

    const { container, dispose } = renderSubagent("idle");
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).toBeNull();

    dispose();
  });

  it("keeps loading spinner through tool output until assistant text arrives", async () => {
    vi.useFakeTimers();
    fetchSubagentLogsMock
      .mockResolvedValueOnce({
        ok: true,
        data: { cursor: 0, events: [] },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 1,
          events: [{ type: "tool_output", text: "tool ran" }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          cursor: 2,
          events: [{ type: "assistant", text: "final reply" }],
        },
      });

    const { container, dispose } = renderSubagent("idle");
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();
    expect(container.querySelector(".log-line.pending")).toBeNull();

    dispose();
  });

  it("renders warning callout for shell tool calls with empty output", async () => {
    fetchSubagentLogsMock.mockResolvedValueOnce({
      ok: true,
      data: {
        cursor: 1,
        events: [
          {
            type: "tool_call",
            tool: { id: "t1", name: "exec_command" },
            text: JSON.stringify({ cmd: "apm start PRO-1 --template worker" }),
          },
          {
            type: "tool_output",
            tool: { id: "t1", name: "exec_command" },
            text: "",
          },
        ],
      },
    });

    const { container, dispose } = renderSubagent("idle");
    await tick();
    await tick();

    const warning = container.querySelector(".log-line.warning");
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain("No output captured.");
    expect(warning?.textContent).toContain("apm start PRO-1 --template worker");

    dispose();
  });

  it("shows Stop while lead agent is streaming", async () => {
    const { container, dispose } = renderLead();
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(container.querySelector(".stop-btn")).not.toBeNull();

    dispose();
  });

  it("calls interruptSubagent when subagent Stop is clicked", async () => {
    const { container, dispose } = renderSubagent("running");
    await tick();

    const stopBtn = container.querySelector(".stop-btn") as HTMLButtonElement;
    stopBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(interruptSubagentMock).toHaveBeenCalledWith("PRO-1", "worker-1");

    dispose();
  });

  it("shows stopping state while subagent interrupt is in flight", async () => {
    interruptSubagentMock.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>
    );
    const { container, dispose } = renderSubagent("running");
    await tick();

    const stopBtn = container.querySelector(".stop-btn") as HTMLButtonElement;
    stopBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const stoppingBtn = container.querySelector(
      ".stop-btn"
    ) as HTMLButtonElement;
    expect(stoppingBtn.disabled).toBe(true);
    expect(stoppingBtn.textContent).toContain("Stopping...");

    dispose();
  });

  it("sends /abort when lead Stop is clicked", async () => {
    const { container, dispose } = renderLead();
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const stopBtn = container.querySelector(".stop-btn") as HTMLButtonElement;
    stopBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(streamMessageMock).toHaveBeenNthCalledWith(
      2,
      "lead-1",
      "/abort",
      "main",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Object),
      expect.any(Object)
    );

    dispose();
  });

  it("shows Send again after lead agent stops", async () => {
    streamMessageMock.mockImplementationOnce(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        _onText: (text: string) => void,
        onDone: () => void,
        _onError: (error: string) => void
      ) => {
        setTimeout(() => onDone(), 0);
        return () => {};
      }
    );
    const { container, dispose } = renderLead();
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.querySelector(".stop-btn")).not.toBeNull();

    await tick();
    await tick();

    expect(container.querySelector(".send-btn")).not.toBeNull();
    expect(container.querySelector(".stop-btn")).toBeNull();

    dispose();
  });
});
