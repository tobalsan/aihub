// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { BoardView } from "./BoardView";

const {
  fetchAgentsMock,
  fetchFullHistoryMock,
  fetchRuntimeSubagentLogsMock,
  fetchRuntimeSubagentsMock,
  getSessionKeyMock,
  streamMessageMock,
  subscribeToSessionMock,
  subscribeToSubagentChangesMock,
  uploadFilesMock,
} = vi.hoisted(() => ({
  fetchAgentsMock: vi.fn(),
  fetchFullHistoryMock: vi.fn(),
  fetchRuntimeSubagentLogsMock: vi.fn(),
  fetchRuntimeSubagentsMock: vi.fn(),
  getSessionKeyMock: vi.fn(),
  streamMessageMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
  subscribeToSubagentChangesMock: vi.fn(),
  uploadFilesMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  archiveRuntimeSubagent: vi.fn(),
  deleteRuntimeSubagent: vi.fn(),
  fetchAgents: fetchAgentsMock,
  fetchFullHistory: fetchFullHistoryMock,
  fetchRuntimeSubagentLogs: fetchRuntimeSubagentLogsMock,
  fetchRuntimeSubagents: fetchRuntimeSubagentsMock,
  getSessionKey: getSessionKeyMock,
  interruptRuntimeSubagent: vi.fn(),
  postAbort: vi.fn(),
  streamMessage: streamMessageMock,
  subscribeToSession: subscribeToSessionMock,
  subscribeToSubagentChanges: subscribeToSubagentChangesMock,
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
  const dispose = render(() => <BoardView />, container);
  return { container, dispose };
}

describe("BoardView attachments", () => {
  beforeEach(() => {
    delegateEvents(["change", "click", "input", "keydown"]);
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ panel: "overview" })))
    );

    fetchAgentsMock.mockResolvedValue([
      {
        id: "agent-1",
        name: "Agent",
        model: { provider: "openai", model: "gpt-5" },
        queueMode: "queue",
      },
    ]);
    fetchFullHistoryMock.mockResolvedValue({
      messages: [],
      thinkingLevel: undefined,
      isStreaming: false,
      activeTurn: null,
    });
    fetchRuntimeSubagentsMock.mockResolvedValue({ items: [] });
    fetchRuntimeSubagentLogsMock.mockResolvedValue({
      events: [],
      nextCursor: 0,
    });
    getSessionKeyMock.mockReturnValue("main");
    streamMessageMock.mockImplementation(() => () => {});
    subscribeToSessionMock.mockImplementation(() => () => {});
    subscribeToSubagentChangesMock.mockImplementation(() => () => {});
    uploadFilesMock.mockResolvedValue([
      {
        path: "/tmp/uploaded/report.pdf",
        mimeType: "application/pdf",
        filename: "report.pdf",
        size: 12,
      },
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uploads selected files and sends them with the board chat message", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const file = new File(["contents"], "report.pdf", {
      type: "application/pdf",
    });
    const fileInput = container.querySelector(".board-file-input");
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected file input");
    }
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    expect(
      container.querySelector(".board-attachment-name")?.textContent
    ).toContain("report.pdf");

    const textarea = container.querySelector(".board-chat-input");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Expected textarea");
    }
    textarea.value = "Review this";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const sendButton = container.querySelector(".board-chat-send");
    if (!(sendButton instanceof HTMLButtonElement)) {
      throw new Error("Expected send button");
    }
    sendButton.click();
    await tick();
    await tick();

    expect(uploadFilesMock).toHaveBeenCalledWith([file]);
    expect(streamMessageMock).toHaveBeenCalledWith(
      "agent-1",
      "Review this",
      "main",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Object),
      {
        attachments: [
          {
            path: "/tmp/uploaded/report.pdf",
            mimeType: "application/pdf",
            filename: "report.pdf",
            size: 12,
          },
        ],
      }
    );

    dispose();
  });

  it("adds pending files when dropped on the board chat", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const messages = container.querySelector(".board-chat-messages");
    if (!(messages instanceof HTMLDivElement)) {
      throw new Error("Expected messages container");
    }

    messages.dispatchEvent(
      createFileDragEvent("drop", [
        new File(["image"], "screenshot.png", { type: "image/png" }),
      ])
    );
    await tick();
    await tick();

    expect(
      container.querySelector(".board-attachment-name")?.textContent
    ).toContain("screenshot.png");

    dispose();
  });
});
