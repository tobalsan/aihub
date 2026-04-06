// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import type { JSX } from "solid-js";
import { ChatView } from "./ChatView";

const params = { agentId: "lead-1", view: undefined as string | undefined };
const navigateMock = vi.fn();

const {
  fetchAgentMock,
  fetchSimpleHistoryMock,
  fetchFullHistoryMock,
  getSessionKeyMock,
  streamMessageMock,
  subscribeToSessionMock,
} = vi.hoisted(() => ({
  fetchAgentMock: vi.fn(),
  fetchSimpleHistoryMock: vi.fn(),
  fetchFullHistoryMock: vi.fn(),
  getSessionKeyMock: vi.fn(),
  streamMessageMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  A: (props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
  useNavigate: () => navigateMock,
  useParams: () => params,
}));

vi.mock("../api/client", () => ({
  fetchAgent: fetchAgentMock,
  fetchSimpleHistory: fetchSimpleHistoryMock,
  fetchFullHistory: fetchFullHistoryMock,
  getSessionKey: getSessionKeyMock,
  streamMessage: streamMessageMock,
  subscribeToSession: subscribeToSessionMock,
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderChatView() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(() => <ChatView />, container);
  return { container, dispose };
}

describe("ChatView interaction polish", () => {
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
  let defaultScrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delegateEvents(["click", "input", "keydown"]);
    params.agentId = "lead-1";
    params.view = undefined;
    navigateMock.mockReset();
    fetchAgentMock.mockResolvedValue({
      id: "lead-1",
      name: "Lead",
      authMode: "oauth",
      queueMode: "queue",
    });
    fetchSimpleHistoryMock.mockResolvedValue({ messages: [] });
    fetchFullHistoryMock.mockResolvedValue({ messages: [] });
    getSessionKeyMock.mockReturnValue("main");
    streamMessageMock.mockImplementation(() => () => {});
    subscribeToSessionMock.mockImplementation(() => () => {});
    originalScrollIntoView = Element.prototype.scrollIntoView;
    defaultScrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = defaultScrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("focuses the textarea on mount", async () => {
    const { container, dispose } = renderChatView();
    await tick();
    await tick();

    expect(document.activeElement).toBe(
      container.querySelector("textarea") as HTMLTextAreaElement
    );

    dispose();
  });

  it("starts a new session on Cmd+K", async () => {
    const { dispose } = renderChatView();
    await tick();
    await tick();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true })
    );
    await tick();

    expect(streamMessageMock).toHaveBeenCalledWith(
      "lead-1",
      "/new",
      "main",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Object),
      undefined
    );

    dispose();
  });

  it("aborts the active stream on Escape", async () => {
    const { container, dispose } = renderChatView();
    await tick();
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
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
      undefined
    );

    dispose();
  });

  it("does not auto-scroll while the reader is away from the bottom", async () => {
    let onText: ((text: string) => void) | undefined;
    streamMessageMock.mockImplementation(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        handleText: (text: string) => void
      ) => {
        onText = handleText;
        return () => {};
      }
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { container, dispose } = renderChatView();
    await tick();
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const messages = container.querySelector(".messages") as HTMLDivElement;
    let scrollTop = 200;
    Object.defineProperty(messages, "scrollHeight", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(messages, "clientHeight", {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(messages, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    scrollIntoView.mockClear();
    messages.dispatchEvent(new Event("scroll"));
    onText?.("reply");
    await tick();

    expect(scrollIntoView).not.toHaveBeenCalled();

    dispose();
  });

  it("resumes auto-scroll once the reader returns near the bottom", async () => {
    let onText: ((text: string) => void) | undefined;
    streamMessageMock.mockImplementation(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        handleText: (text: string) => void
      ) => {
        onText = handleText;
        return () => {};
      }
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { container, dispose } = renderChatView();
    await tick();
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const messages = container.querySelector(".messages") as HTMLDivElement;
    let scrollTop = 405;
    Object.defineProperty(messages, "scrollHeight", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(messages, "clientHeight", {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(messages, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    scrollIntoView.mockClear();
    messages.dispatchEvent(new Event("scroll"));
    onText?.("reply");
    await tick();

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto" });

    dispose();
  });

  it("clears Sending status on first stream chunk", async () => {
    let onText: ((text: string) => void) | undefined;
    streamMessageMock.mockImplementation(
      (
        _agentId: string,
        _message: string,
        _sessionKey: string,
        handleText: (text: string) => void
      ) => {
        onText = handleText;
        return () => {};
      }
    );

    const { container, dispose } = renderChatView();
    await tick();
    await tick();

    const input = container.querySelector("textarea") as HTMLTextAreaElement;
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    expect(container.textContent).toContain("Sending...");

    onText?.("reply");
    await tick();

    expect(container.textContent).not.toContain("Sending...");

    dispose();
  });

  it("virtualizes long histories", async () => {
    fetchSimpleHistoryMock.mockResolvedValue({
      messages: Array.from({ length: 50 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index}`,
        timestamp: index + 1,
      })),
    });

    const { container, dispose } = renderChatView();
    await tick();
    await tick();

    expect(
      container.querySelectorAll(".message-virtual-row").length
    ).toBeLessThan(50);

    dispose();
  });
});
