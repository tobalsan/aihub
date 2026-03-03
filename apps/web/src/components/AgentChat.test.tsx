// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { AgentChat } from "./AgentChat";

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
    delegateEvents(["click", "input", "keydown"]);
    fetchFullHistoryMock.mockResolvedValue({ messages: [] });
    fetchSubagentsMock.mockResolvedValue({ ok: true, data: { items: [] } });
    fetchSubagentLogsMock.mockResolvedValue({
      ok: true,
      data: { cursor: 0, events: [] },
    });
    getSessionKeyMock.mockReturnValue("main");
    spawnSubagentMock.mockResolvedValue({ ok: true, data: { slug: "worker-1" } });
    streamMessageMock.mockImplementation(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        _onText: (text: string) => void,
        _onDone: () => void,
        _onError: (error: string) => void
      ) => () => {}
    );
    subscribeToSessionMock.mockImplementation(() => () => {});
    uploadFilesMock.mockResolvedValue([]);
    interruptSubagentMock.mockResolvedValue({ ok: true, data: { slug: "worker-1" } });
    killSubagentMock.mockResolvedValue({ ok: true, data: { slug: "worker-1" } });
    archiveSubagentMock.mockResolvedValue({
      ok: true,
      data: { slug: "worker-1", archived: true },
    });
  });

  afterEach(() => {
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

    const stoppingBtn = container.querySelector(".stop-btn") as HTMLButtonElement;
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
