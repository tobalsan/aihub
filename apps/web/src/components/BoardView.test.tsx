// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { BoardView } from "./BoardView";

const {
  fetchAgentsMock,
  fetchBoardProjectsMock,
  fetchFullHistoryMock,
  fetchProjectMock,
  getSessionKeyMock,
  streamMessageMock,
  subscribeToSessionMock,
  subscribeToFileChangesMock,
  uploadFilesMock,
} = vi.hoisted(() => ({
  fetchAgentsMock: vi.fn(),
  fetchBoardProjectsMock: vi.fn(),
  fetchFullHistoryMock: vi.fn(),
  fetchProjectMock: vi.fn(),
  getSessionKeyMock: vi.fn(),
  streamMessageMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
  subscribeToFileChangesMock: vi.fn(),
  uploadFilesMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [{}, vi.fn()],
}));

vi.mock("../api/client", () => ({
  createProject: vi.fn(),
  fetchAgents: fetchAgentsMock,
  fetchBoardProjects: fetchBoardProjectsMock,
  fetchFullHistory: fetchFullHistoryMock,
  fetchProject: fetchProjectMock,
  fetchRuntimeSubagentLogs: vi.fn(),
  getSessionKey: getSessionKeyMock,
  interruptRuntimeSubagent: vi.fn(),
  postAbort: vi.fn(),
  resumeRuntimeSubagent: vi.fn(),
  streamMessage: streamMessageMock,
  subscribeToFileChanges: subscribeToFileChangesMock,
  subscribeToSession: subscribeToSessionMock,
  updateProject: vi.fn(),
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
    fetchBoardProjectsMock.mockResolvedValue([
      {
        id: "PRO-1",
        title: "Embedded Overview Project",
        area: "platform",
        status: "maybe",
        group: "active",
        created: "2026-04-30T10:00:00.000Z",
        worktrees: [],
      },
    ]);
    fetchProjectMock.mockResolvedValue({
      id: "PRO-1",
      title: "Embedded Overview Project",
      path: "PRO-1",
      absolutePath: "/tmp/PRO-1",
      repoValid: true,
      frontmatter: { status: "maybe" },
      docs: { README: "# Embedded Overview Project\n\nBoard tab content." },
      thread: [],
    });
    getSessionKeyMock.mockReturnValue("main");
    streamMessageMock.mockImplementation(() => () => {});
    subscribeToSessionMock.mockImplementation(() => () => {});
    subscribeToFileChangesMock.mockReturnValue(() => {});
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

  it("renders ProjectsOverview in the Projects tab", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const projectsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".board-canvas-tab")
    ).find((button) => button.textContent === "Projects");
    projectsTab?.click();
    await tick();
    await tick();

    expect(container.querySelector(".projects-overview")).not.toBeNull();
    expect(container.textContent).toContain("Embedded Overview Project");

    dispose();
  });

  it("keeps project row selection out of board canvas state", async () => {
    fetchBoardProjectsMock.mockResolvedValue([
      {
        id: "PRO-1",
        title: "Embedded Overview Project",
        area: "platform",
        status: "maybe",
        group: "active",
        created: "2026-04-30T10:00:00.000Z",
        worktrees: [],
      },
      {
        id: "PRO-2",
        title: "Second Embedded Project",
        area: "platform",
        status: "maybe",
        group: "active",
        created: "2026-04-30T10:00:00.000Z",
        worktrees: [],
      },
    ]);
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const projectsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".board-canvas-tab")
    ).find((button) => button.textContent === "Projects");
    projectsTab?.click();
    await tick();
    await tick();

    vi.mocked(fetch).mockClear();
    const row = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".po-project-row")
    ).find((button) => button.textContent?.includes("Second Embedded Project"));
    row?.click();
    await tick();

    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([, init]) =>
          String(init?.body ?? "").includes("projects:detail")
        )
    ).toBe(false);
    expect(container.querySelector(".po-detail")?.textContent).toContain(
      "Second Embedded Project"
    );

    dispose();
  });
});
