// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "solid-js/web";
import { BoardLifecycleListPage } from "./BoardLifecycleListPage";

const {
  navigateMock,
  projectListPropsMock,
  fetchBoardProjectsMock,
  fetchAreaSummariesMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  projectListPropsMock: vi.fn(),
  fetchBoardProjectsMock: vi.fn(),
  fetchAreaSummariesMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../api/client", () => ({
  fetchBoardProjects: fetchBoardProjectsMock,
  fetchAreaSummaries: fetchAreaSummariesMock,
  subscribeToFileChanges: () => () => undefined,
  subscribeToSubagentChanges: () => () => undefined,
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
  });

  it("loads board projects + areas, maps area title, navigates on card click", async () => {
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
      const lastCall = projectListPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(lastCall.projects).toHaveLength(1);
      expect(lastCall.areas).toEqual([{ id: "web", name: "Web" }]);
    });

    const lastCall = projectListPropsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const onProjectClick = lastCall.onProjectClick as (project: { id: string }) => void;
    onProjectClick({ id: "PRO-101" });
    expect(navigateMock).toHaveBeenCalledWith("/board/projects/PRO-101");

    dispose();
    document.body.removeChild(container);
  });
});
