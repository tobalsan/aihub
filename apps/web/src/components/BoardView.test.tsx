// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, createSignal } from "solid-js";
import { delegateEvents, render } from "solid-js/web";
import { BoardView } from "./BoardView";

const [searchParamsSignal, setSearchParamsSignal] = createSignal<
  Record<string, string | undefined>
>({});
const searchParamsProxy = new Proxy(
  {},
  {
    get(_target, key: string) {
      return searchParamsSignal()[key];
    },
  }
);

const {
  fetchAgentsMock,
  fetchAreaSummariesMock,
  fetchBoardProjectsMock,
  fetchFullHistoryMock,
  fetchProjectMock,
  getSessionKeyMock,
  streamMessageMock,
  subscribeToSessionMock,
  subscribeToFileChangesMock,
  subscribeToSubagentChangesMock,
  uploadFilesMock,
} = vi.hoisted(() => ({
  fetchAgentsMock: vi.fn(),
  fetchAreaSummariesMock: vi.fn(),
  fetchBoardProjectsMock: vi.fn(),
  fetchFullHistoryMock: vi.fn(),
  fetchProjectMock: vi.fn(),
  getSessionKeyMock: vi.fn(),
  streamMessageMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
  subscribeToFileChangesMock: vi.fn(),
  subscribeToSubagentChangesMock: vi.fn(),
  uploadFilesMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [
    searchParamsProxy,
    (next: Record<string, string | undefined>) => {
      setSearchParamsSignal((prev) => ({ ...prev, ...next }));
    },
  ],
}));

// Mock heavy sub-components used by BoardProjectDetailPage
vi.mock("./board/DocEditor", () => ({
  DocEditor: (props: {
    projectId: string;
    docKey: string;
    content: string;
  }) => (
    <div
      data-testid="doc-editor"
      data-dockey={props.docKey}
      data-project-id={props.projectId}
    />
  ),
}));

vi.mock("../SliceKanbanWidget", () => ({
  SliceKanbanWidget: (props: { projectId: string }) => (
    <div data-testid="slice-kanban" data-project-id={props.projectId} />
  ),
}));

vi.mock("../ActivityFeed", () => ({
  ActivityFeed: (props: { projectId: string }) => (
    <div data-testid="activity-feed" data-project-id={props.projectId} />
  ),
}));

vi.mock("../api/client", () => ({
  addProjectComment: vi.fn(),
  createProject: vi.fn(),
  createSlice: vi.fn(),
  fetchAgents: fetchAgentsMock,
  fetchAreas: vi.fn(async () => []),
  fetchAreaSummaries: fetchAreaSummariesMock,
  fetchBoardActivity: vi.fn(async () => ({ items: [] })),
  fetchBoardProjects: fetchBoardProjectsMock,
  fetchFullHistory: fetchFullHistoryMock,
  fetchProject: fetchProjectMock,
  fetchRuntimeSubagentLogs: vi.fn(),
  fetchSlices: vi.fn(async () => []),
  getSessionKey: getSessionKeyMock,
  moveBoardProject: vi.fn(),
  interruptRuntimeSubagent: vi.fn(),
  postAbort: vi.fn(),
  resumeRuntimeSubagent: vi.fn(),
  streamMessage: streamMessageMock,
  subscribeToFileChanges: subscribeToFileChangesMock,
  subscribeToSubagentChanges: subscribeToSubagentChangesMock,
  subscribeToSession: subscribeToSessionMock,
  updateProject: vi.fn(),
  updateSlice: vi.fn(),
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

function renderViewWithParentSuspense() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <Suspense
        fallback={<div data-testid="parent-suspense">Parent loading</div>}
      >
        <BoardView />
      </Suspense>
    ),
    container
  );
  return { container, dispose };
}

describe("BoardView attachments", () => {
  beforeEach(() => {
    setSearchParamsSignal({});
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
        status: "active",
        lifecycleStatus: "active",
        group: "active",
        created: "2026-04-30T10:00:00.000Z",
        sliceProgress: { done: 1, total: 2 },
        lastActivity: "2026-04-30T10:00:00.000Z",
        activeRunCount: 0,
        worktrees: [],
      },
    ]);
    fetchAreaSummariesMock.mockResolvedValue([
      { id: "platform", title: "Platform", projectCount: 1 },
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
    subscribeToSubagentChangesMock.mockReturnValue(() => {});
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

  it("renders the lifecycle list in the Project lifecycle tab", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const projectsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".board-canvas-tab")
    ).find((button) => button.textContent === "Project lifecycle");
    projectsTab?.click();
    await tick();
    await tick();

    expect(
      container.querySelector('[data-testid="project-list-grouped"]')
    ).not.toBeNull();
    expect(container.textContent).toContain("Embedded Overview Project");

    dispose();
  });

  it("keeps project row selection out of board canvas state", async () => {
    fetchBoardProjectsMock.mockResolvedValue([
      {
        id: "PRO-1",
        title: "Embedded Overview Project",
        area: "platform",
        status: "active",
        lifecycleStatus: "active",
        group: "active",
        created: "2026-04-30T10:00:00.000Z",
        sliceProgress: { done: 0, total: 1 },
        lastActivity: "2026-04-30T10:00:00.000Z",
        activeRunCount: 0,
        worktrees: [],
      },
      {
        id: "PRO-2",
        title: "Second Embedded Project",
        area: "platform",
        status: "active",
        lifecycleStatus: "active",
        group: "active",
        created: "2026-04-30T10:00:00.000Z",
        sliceProgress: { done: 0, total: 1 },
        lastActivity: "2026-04-30T10:00:00.000Z",
        activeRunCount: 0,
        worktrees: [],
      },
    ]);
    fetchProjectMock.mockResolvedValue({
      id: "PRO-2",
      title: "Second Embedded Project",
      path: "PRO-2",
      absolutePath: "/tmp/PRO-2",
      repoValid: true,
      frontmatter: { status: "active" },
      docs: { README: "# Second Embedded Project" },
      thread: [],
    });
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const projectsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".board-canvas-tab")
    ).find((button) => button.textContent === "Project lifecycle");
    projectsTab?.click();
    await tick();
    await tick();

    vi.mocked(fetch).mockClear();
    const row = container.querySelector<HTMLElement>(
      '[data-testid="project-card-PRO-2"]'
    );
    row?.click();
    await tick();
    await tick();

    // Canvas state must NOT be updated to projects:detail
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([, init]) =>
          String(init?.body ?? "").includes("projects:detail")
        )
    ).toBe(false);
    // Detail page shown inline — .bpd element present
    expect(container.querySelector(".bpd")).not.toBeNull();
    // No router navigation triggered
    expect(container.textContent).toContain("Second Embedded Project");

    dispose();
  });

  it("clicking a project in lifecycle tab shows BoardProjectDetailPage inline", async () => {
    const { container, dispose } = renderView();
    await tick();
    await tick();

    const projectsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".board-canvas-tab")
    ).find((button) => button.textContent === "Project lifecycle");
    projectsTab?.click();
    await tick();
    await tick();

    // List is visible before clicking
    expect(
      container.querySelector('[data-testid="project-list-grouped"]')
    ).not.toBeNull();

    const row = container.querySelector<HTMLElement>(
      '[data-testid="project-card-PRO-1"]'
    );
    row?.click();
    await tick();
    await tick();

    // List hidden, detail page shown
    expect(
      container.querySelector('[data-testid="project-list-grouped"]')
    ).toBeNull();
    expect(container.querySelector(".bpd")).not.toBeNull();
    // Back button returns to list
    const back = container.querySelector(".bpd-back") as HTMLButtonElement;
    back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(
      container.querySelector('[data-testid="project-list-grouped"]')
    ).not.toBeNull();
    expect(container.querySelector(".bpd")).toBeNull();

    dispose();
  });

  it("project detail loading stays inside the canvas Suspense boundary", async () => {
    fetchProjectMock.mockImplementation(() => new Promise(() => {}));
    const { container, dispose } = renderViewWithParentSuspense();
    await tick();
    await tick();

    const projectsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".board-canvas-tab")
    ).find((button) => button.textContent === "Project lifecycle");
    projectsTab?.click();
    await tick();
    await tick();

    const row = container.querySelector<HTMLElement>(
      '[data-testid="project-card-PRO-1"]'
    );
    row?.click();
    await tick();

    expect(
      container.querySelector("[data-testid='parent-suspense']")
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='canvas-loading']")
    ).not.toBeNull();
    expect(container.querySelector(".board-chat")).not.toBeNull();

    dispose();
  });
});
