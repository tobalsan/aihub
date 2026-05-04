// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "solid-js/web";
import { BoardLifecycleListPage } from "./BoardLifecycleListPage";

const {
  navigateMock,
  projectListPropsMock,
  fetchBoardProjectsMock,
  fetchAreaSummariesMock,
  subscribeToFileChangesMock,
  subscribeToSubagentChangesMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  projectListPropsMock: vi.fn(),
  fetchBoardProjectsMock: vi.fn(),
  fetchAreaSummariesMock: vi.fn(),
  subscribeToFileChangesMock: vi.fn(() => () => undefined),
  subscribeToSubagentChangesMock: vi.fn(() => () => undefined),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../api/client", () => ({
  fetchBoardProjects: fetchBoardProjectsMock,
  fetchAreaSummaries: fetchAreaSummariesMock,
  subscribeToFileChanges: subscribeToFileChangesMock,
  subscribeToSubagentChanges: subscribeToSubagentChangesMock,
}));

vi.mock("./ProjectListGrouped", () => ({
  ProjectListGrouped: (props: unknown) => {
    projectListPropsMock(props);
    return <div data-testid="project-list-grouped-stub" />;
  },
}));

describe("BoardLifecycleListPage", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    projectListPropsMock.mockReset();
    fetchBoardProjectsMock.mockReset();
    fetchAreaSummariesMock.mockReset();
    subscribeToFileChangesMock.mockReset();
    subscribeToFileChangesMock.mockReturnValue(() => undefined);
    subscribeToSubagentChangesMock.mockReset();
    subscribeToSubagentChangesMock.mockReturnValue(() => undefined);
  });

  it("loads board projects + areas, maps area title, navigates on card click when no onProjectClick prop", async () => {
    fetchBoardProjectsMock.mockResolvedValue([
      {
        id: "PRO-101",
        title: "Alpha",
        area: "web",
        status: "active",
        lifecycleStatus: "active",
        group: "active",
        created: "2026-01-01",
        sliceProgress: { done: 1, total: 2 },
        lastActivity: null,
        activeRunCount: 0,
        worktrees: [],
      },
    ]);
    fetchAreaSummariesMock.mockResolvedValue([
      {
        id: "web",
        title: "Web",
        color: "#000",
        order: 1,
        hidden: false,
        recentlyDone: "",
        whatsNext: "",
      },
    ]);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <BoardLifecycleListPage />, container);

    await vi.waitFor(() => {
      expect(projectListPropsMock).toHaveBeenCalled();
      const lastCall = projectListPropsMock.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
      expect(lastCall.projects).toHaveLength(1);
      expect(lastCall.areas).toEqual([{ id: "web", name: "Web" }]);
    });

    const lastCall = projectListPropsMock.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    const onProjectClick = lastCall.onProjectClick as (project: {
      id: string;
    }) => void;
    onProjectClick({ id: "PRO-101" });
    expect(navigateMock).toHaveBeenCalledWith("/board/projects/PRO-101");

    dispose();
    document.body.removeChild(container);
  });

  it("calls onProjectClick prop instead of navigating when provided (embedded mode)", async () => {
    fetchBoardProjectsMock.mockResolvedValue([]);
    fetchAreaSummariesMock.mockResolvedValue([]);

    const onProjectClick = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => <BoardLifecycleListPage onProjectClick={onProjectClick} />,
      container
    );

    await vi.waitFor(() => {
      expect(projectListPropsMock).toHaveBeenCalled();
    });

    const lastCall = projectListPropsMock.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    const clickHandler = lastCall.onProjectClick as (project: {
      id: string;
    }) => void;
    clickHandler({ id: "PRO-202" });

    // Custom handler called, navigate NOT called
    expect(onProjectClick).toHaveBeenCalledWith({ id: "PRO-202" });
    expect(navigateMock).not.toHaveBeenCalled();

    dispose();
    document.body.removeChild(container);
  });

  it("debounces file changes and subagent lifecycle transitions", async () => {
    vi.useFakeTimers();
    try {
      fetchBoardProjectsMock.mockResolvedValue([]);
      fetchAreaSummariesMock.mockResolvedValue([]);

      const container = document.createElement("div");
      document.body.appendChild(container);
      const dispose = render(() => <BoardLifecycleListPage />, container);
      await vi.runAllTimersAsync();

      const fileCallbacks = subscribeToFileChangesMock.mock.calls[0]?.[0];
      const runCallbacks = subscribeToSubagentChangesMock.mock.calls[0]?.[0];
      expect(fileCallbacks).toBeTruthy();
      expect(runCallbacks).toBeTruthy();

      fileCallbacks.onFileChanged("PRO-1", "PRO-1/README.md");
      fileCallbacks.onFileChanged("PRO-2", "PRO-2/SPECS.md");
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchBoardProjectsMock).toHaveBeenCalledTimes(2);

      runCallbacks.onSubagentChanged({ runId: "run-1", status: "running" });
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchBoardProjectsMock).toHaveBeenCalledTimes(3);

      runCallbacks.onSubagentChanged({ runId: "run-1", status: "running" });
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchBoardProjectsMock).toHaveBeenCalledTimes(3);

      runCallbacks.onSubagentChanged({ runId: "run-1", status: "done" });
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchBoardProjectsMock).toHaveBeenCalledTimes(4);

      dispose();
      document.body.removeChild(container);
    } finally {
      vi.useRealTimers();
    }
  });
});
