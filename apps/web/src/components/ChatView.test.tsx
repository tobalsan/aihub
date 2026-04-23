// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { ChatView } from "./ChatView";

const navigateMock = vi.fn();

const {
  fetchAgentMock,
  fetchSimpleHistoryMock,
  fetchFullHistoryMock,
  fetchAgentStatusesMock,
  getSessionKeyMock,
  postAbortMock,
  streamMessageMock,
  subscribeToSessionMock,
  subscribeToStatusMock,
  uploadFilesMock,
} = vi.hoisted(() => ({
  fetchAgentMock: vi.fn(),
  fetchSimpleHistoryMock: vi.fn(),
  fetchFullHistoryMock: vi.fn(),
  fetchAgentStatusesMock: vi.fn(),
  getSessionKeyMock: vi.fn(),
  postAbortMock: vi.fn(),
  streamMessageMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
  subscribeToStatusMock: vi.fn(),
  uploadFilesMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  A: (props: Record<string, unknown>) => <a {...props} />,
  useNavigate: () => navigateMock,
  useParams: () => ({ agentId: "agent-1" }),
}));

vi.mock("../api/client", () => ({
  fetchAgent: fetchAgentMock,
  fetchSimpleHistory: fetchSimpleHistoryMock,
  fetchFullHistory: fetchFullHistoryMock,
  fetchAgentStatuses: fetchAgentStatusesMock,
  getSessionKey: getSessionKeyMock,
  postAbort: postAbortMock,
  streamMessage: streamMessageMock,
  subscribeToSession: subscribeToSessionMock,
  subscribeToStatus: subscribeToStatusMock,
  uploadFiles: uploadFilesMock,
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderView() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(() => <ChatView />, container);
  return { container, dispose };
}

describe("ChatView abort handling", () => {
  beforeEach(() => {
    delegateEvents(["click", "input", "keydown"]);
    Element.prototype.scrollIntoView = vi.fn();

    fetchAgentMock.mockResolvedValue({
      id: "agent-1",
      name: "Agent",
      model: { provider: "openai", model: "gpt-5" },
      queueMode: "queue",
    });
    fetchSimpleHistoryMock.mockResolvedValue({
      messages: [],
      thinkingLevel: undefined,
      isStreaming: false,
      activeTurn: null,
    });
    fetchFullHistoryMock.mockResolvedValue({
      messages: [],
      thinkingLevel: undefined,
      isStreaming: false,
      activeTurn: null,
    });
    fetchAgentStatusesMock.mockResolvedValue({ statuses: { "agent-1": "idle" } });
    getSessionKeyMock.mockReturnValue("main");
    postAbortMock.mockResolvedValue(undefined);
    streamMessageMock.mockImplementation(() => () => {});
    subscribeToSessionMock.mockImplementation(() => () => {});
    subscribeToStatusMock.mockImplementation(() => () => {});
    uploadFilesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("keeps streamed assistant text visible after Stop aborts the run", async () => {
    let onText: ((chunk: string) => void) | undefined;
    let onDone: (() => void) | undefined;
    const cleanupSpy = vi.fn();
    streamMessageMock.mockImplementation(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        nextOnText: (chunk: string) => void,
        nextOnDone: () => void
      ) => {
        onText = nextOnText;
        onDone = nextOnDone;
        return cleanupSpy;
      }
    );

    const { container, dispose } = renderView();
    await tick();
    await tick();

    const textarea = container.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Expected chat textarea");
    }
    textarea.value = "hello";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    const sendBtn = container.querySelector(".send-btn");
    if (!(sendBtn instanceof HTMLButtonElement)) {
      throw new Error("Expected send button");
    }
    sendBtn.click();
    await tick();

    onText?.("partial answer");
    await tick();

    const stopBtn = container.querySelector(".stop-btn");
    if (!(stopBtn instanceof HTMLButtonElement)) {
      throw new Error("Expected stop button");
    }
    stopBtn.click();
    await tick();

    expect(postAbortMock).toHaveBeenCalledWith("agent-1", "main");
    expect(cleanupSpy).not.toHaveBeenCalled();

    onDone?.();
    await tick();

    expect(container.textContent).toContain("partial answer");
    expect(container.textContent).toContain("Interrupted");

    dispose();
  });
});
