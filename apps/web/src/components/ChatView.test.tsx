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
  routeState,
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
  routeState: { view: undefined as string | undefined },
}));

vi.mock("@solidjs/router", () => ({
  A: (props: Record<string, unknown>) => <a {...props} />,
  useNavigate: () => navigateMock,
  useParams: () => ({ agentId: "agent-1", view: routeState.view }),
}));

vi.mock("../api", () => ({
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

function createFileDragEvent(
  type: "dragenter" | "dragover" | "drop",
  files: File[]
) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"], dropEffect: "none" },
  });
  return event;
}

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
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();

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
    routeState.view = undefined;
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

  it("renders full-mode stream blocks chronologically", async () => {
    let onText: ((chunk: string) => void) | undefined;
    let onDone: (() => void) | undefined;
    let callbacks:
      | {
          onToolCall?: (id: string, name: string, args: unknown) => void;
          onToolResult?: (
            id: string,
            name: string,
            content: string,
            isError: boolean
          ) => void;
        }
      | undefined;
    let subscriptionCallbacks:
      | {
          onDone?: () => void;
          onHistoryUpdated?: () => void;
        }
      | undefined;
    subscribeToSessionMock.mockImplementation(
      (_agentId: string, _sessionKey: string, callbacksArg) => {
        subscriptionCallbacks = callbacksArg;
        return vi.fn();
      }
    );
    streamMessageMock.mockImplementation(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        nextOnText: (chunk: string) => void,
        nextOnDone: () => void,
        _onError: (error: string) => void,
        nextCallbacks?: typeof callbacks
      ) => {
        onText = nextOnText;
        onDone = nextOnDone;
        callbacks = nextCallbacks;
        return vi.fn();
      }
    );

    routeState.view = "full";
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

    const fetchesBeforeDone = fetchFullHistoryMock.mock.calls.length;
    onText?.("First text.");
    callbacks?.onToolCall?.("tool-1", "bash", { command: "date" });
    callbacks?.onToolResult?.("tool-1", "bash", "tool output", false);
    onText?.(" Last text.");
    await tick();

    const liveText = container.textContent ?? "";
    expect(liveText.indexOf("First text.")).toBeLessThan(
      liveText.indexOf("bash")
    );
    expect(liveText.indexOf("tool output")).toBeLessThan(
      liveText.indexOf("Last text.")
    );

    onDone?.();
    await tick();

    const finalText = container.textContent ?? "";
    expect(finalText.indexOf("First text.")).toBeLessThan(
      finalText.indexOf("bash")
    );
    expect(finalText.indexOf("tool output")).toBeLessThan(
      finalText.indexOf("Last text.")
    );
    expect(fetchFullHistoryMock.mock.calls.length).toBe(fetchesBeforeDone);
    subscriptionCallbacks?.onDone?.();
    await tick();
    expect(container.textContent).toContain("tool output");
    subscriptionCallbacks?.onHistoryUpdated?.();
    await tick();
    expect(fetchFullHistoryMock.mock.calls.length).toBe(fetchesBeforeDone);

    dispose();
  });

  it("adds pending files when dropped on the chat history", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const history = container.querySelector(".messages");
    if (!(history instanceof HTMLDivElement)) {
      throw new Error("Expected messages container");
    }

    history.dispatchEvent(
      createFileDragEvent("drop", [
        new File(["image"], "history-drop.png", { type: "image/png" }),
      ])
    );
    await tick();
    await tick();

    expect(container.querySelector(".attachment-name")?.textContent).toContain(
      "history-drop.png"
    );

    dispose();
  });

  it("adds pending files when dropped on the text input", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const textarea = container.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Expected chat textarea");
    }

    textarea.dispatchEvent(
      createFileDragEvent("drop", [
        new File(["doc"], "notes.md", { type: "text/markdown" }),
      ])
    );
    await tick();
    await tick();

    expect(container.querySelector(".attachment-name")?.textContent).toContain(
      "notes.md"
    );

    dispose();
  });

  it("adds pending files when dropped on the attach button", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const attachButton = container.querySelector(".attach-btn");
    if (!(attachButton instanceof HTMLButtonElement)) {
      throw new Error("Expected attach button");
    }

    attachButton.dispatchEvent(
      createFileDragEvent("drop", [
        new File(["sheet"], "budget.csv", { type: "text/csv" }),
      ])
    );
    await tick();
    await tick();

    expect(container.querySelector(".attachment-name")?.textContent).toContain(
      "budget.csv"
    );

    dispose();
  });

  it("shows drag feedback for the composer while a file is over the input", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const textarea = container.querySelector("textarea");
    const chatView = container.querySelector(".chat-view");
    const inputWrapper = container.querySelector(".input-wrapper");
    if (
      !(textarea instanceof HTMLTextAreaElement) ||
      !(chatView instanceof HTMLDivElement) ||
      !(inputWrapper instanceof HTMLDivElement)
    ) {
      throw new Error("Expected chat composer elements");
    }

    const file = new File(["image"], "composer.png", { type: "image/png" });
    textarea.dispatchEvent(createFileDragEvent("dragenter", [file]));
    textarea.dispatchEvent(createFileDragEvent("dragover", [file]));
    await tick();

    expect(chatView.classList.contains("drop-active")).toBe(true);
    expect(inputWrapper.classList.contains("drop-target")).toBe(true);
    expect(container.textContent).toContain(
      "Drop files to attach them to your next message."
    );

    dispose();
  });
});
