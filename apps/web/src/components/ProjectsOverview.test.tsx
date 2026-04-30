// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { ProjectsOverview } from "./ProjectsOverview";
import type { BoardProject, BoardWorktree, ProjectDetail } from "../api/types";

const {
  createProjectMock,
  fetchBoardProjectsMock,
  fetchProjectMock,
  fetchRuntimeSubagentLogsMock,
  interruptRuntimeSubagentMock,
  navigateMock,
  resumeRuntimeSubagentMock,
  setSearchParamsMock,
  subscribeToFileChangesMock,
  updateProjectMock,
} = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
  fetchBoardProjectsMock: vi.fn(),
  fetchProjectMock: vi.fn(),
  fetchRuntimeSubagentLogsMock: vi.fn(),
  interruptRuntimeSubagentMock: vi.fn(),
  navigateMock: vi.fn(),
  resumeRuntimeSubagentMock: vi.fn(),
  setSearchParamsMock: vi.fn(),
  subscribeToFileChangesMock: vi.fn(),
  updateProjectMock: vi.fn(),
}));

let routeId: string | undefined;

vi.mock("@solidjs/router", () => ({
  useParams: () => ({
    get id() {
      return routeId;
    },
  }),
  useNavigate: () => navigateMock,
  useSearchParams: () => [{}, setSearchParamsMock],
}));

vi.mock("../api/client", () => ({
  createProject: createProjectMock,
  fetchBoardProjects: fetchBoardProjectsMock,
  fetchProject: fetchProjectMock,
  fetchRuntimeSubagentLogs: fetchRuntimeSubagentLogsMock,
  interruptRuntimeSubagent: interruptRuntimeSubagentMock,
  resumeRuntimeSubagent: resumeRuntimeSubagentMock,
  subscribeToFileChanges: subscribeToFileChangesMock,
  updateProject: updateProjectMock,
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function worktree(
  id: string,
  queueStatus: BoardWorktree["queueStatus"],
  runStatus?: string
): BoardWorktree {
  return {
    id,
    name: id,
    path: `/tmp/worktrees/${id}`,
    workerSlug: id,
    worktreePath: `/tmp/worktrees/${id}`,
    branch: `branch/${id}`,
    dirty: false,
    ahead: 0,
    queueStatus,
    agentRun: runStatus
      ? {
          runId: `run-${id}`,
          label: id,
          cli: "codex",
          status: runStatus,
          startedAt: "2026-04-30T10:00:00.000Z",
          updatedAt: "2026-04-30T10:05:00.000Z",
        }
      : null,
    startedAt: "2026-04-30T10:00:00.000Z",
  };
}

function project(
  id: string,
  title: string,
  status = "maybe",
  worktrees: BoardWorktree[] = []
): BoardProject {
  return {
    id,
    title,
    area: "platform",
    status,
    group: status === "done" ? "done" : "active",
    created: "2026-04-30T10:00:00.000Z",
    worktrees,
  };
}

function detail(id: string, title = "Alpha Project"): ProjectDetail {
  return {
    id,
    title,
    path: id,
    absolutePath: `/tmp/${id}`,
    repoValid: true,
    frontmatter: { id, title, status: "maybe" },
    docs: { README: `# ${title}\n\nReadable preview.` },
    thread: [],
  };
}

function renderOverview(id?: string) {
  routeId = id;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(() => <ProjectsOverview />, container);
  return { container, dispose };
}

describe("ProjectsOverview", () => {
  beforeEach(() => {
    delegateEvents(["click", "input", "keydown", "submit", "blur"]);
    routeId = undefined;
    fetchBoardProjectsMock.mockResolvedValue([
      project("PRO-1", "Alpha Project", "maybe", [
        worktree("worker-a", "pending", "running"),
      ]),
      project("PRO-2", "Beta Project", "done"),
      project("PRO-3", "Archived Project", "archived"),
    ]);
    fetchProjectMock.mockImplementation((id: string) => Promise.resolve(detail(id)));
    createProjectMock.mockResolvedValue({ ok: true, data: detail("PRO-9", "New Project") });
    updateProjectMock.mockResolvedValue(detail("PRO-1"));
    fetchRuntimeSubagentLogsMock.mockResolvedValue({
      cursor: 1,
      events: [{ type: "stdout", text: "hello logs" }],
    });
    interruptRuntimeSubagentMock.mockResolvedValue({ ok: true, data: {} });
    resumeRuntimeSubagentMock.mockResolvedValue({ ok: true, data: {} });
    subscribeToFileChangesMock.mockReturnValue(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders project list from the board API response", async () => {
    const { container, dispose } = renderOverview("PRO-1");
    await tick();
    expect(container.textContent).toContain("Alpha Project");
    expect(container.textContent).toContain("1 wt");
    expect(container.textContent).toContain("platform");
    dispose();
  });

  it("selecting a project updates the URL and selected detail pane", async () => {
    const { container, dispose } = renderOverview("PRO-1");
    await tick();
    const row = Array.from(container.querySelectorAll<HTMLButtonElement>(".po-project-row")).find(
      (button) => button.textContent?.includes("Alpha Project")
    );
    row?.click();
    expect(navigateMock).toHaveBeenCalledWith("/projects/PRO-1");
    expect(container.querySelector(".po-detail")?.textContent).toContain("Alpha Project");
    dispose();
  });

  it("filter toggle works", async () => {
    const { container, dispose } = renderOverview();
    await tick();
    const done = Array.from(container.querySelectorAll<HTMLButtonElement>(".po-filter")).find(
      (button) => button.textContent === "Done"
    );
    done?.click();
    await tick();
    expect(container.textContent).toContain("Beta Project");
    expect(container.textContent).not.toContain("Alpha Project");
    dispose();
  });

  it("search filters list by title", async () => {
    const { container, dispose } = renderOverview();
    await tick();
    const input = container.querySelector<HTMLInputElement>(".po-search")!;
    input.value = "alp";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await tick();
    expect(container.textContent).toContain("Alpha Project");
    expect(container.textContent).not.toContain("Beta Project");
    dispose();
  });

  it("renders empty state when no projects match", async () => {
    fetchBoardProjectsMock.mockResolvedValue([]);
    const { container, dispose } = renderOverview();
    await tick();
    expect(container.textContent).toContain("No projects match this view.");
    dispose();
  });

  it("+ New creates a project and selects it", async () => {
    const { container, dispose } = renderOverview();
    await tick();
    const newButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "+ New"
    );
    newButton?.click();
    await tick();
    const input = container.querySelector<HTMLInputElement>(".po-create-title")!;
    input.value = "New Project";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    container.querySelector<HTMLFormElement>(".po-modal")?.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true })
    );
    await tick();
    expect(createProjectMock).toHaveBeenCalledWith({ title: "New Project" });
    expect(navigateMock).toHaveBeenCalledWith("/projects/PRO-9");
    dispose();
  });

  it("renders worktree status pill for each queue and run combo", async () => {
    fetchBoardProjectsMock.mockResolvedValue([
      project("PRO-1", "Alpha Project", "maybe", [
        worktree("running", null, "running"),
        worktree("failed", null, "failed"),
        worktree("conflict", "conflict"),
        worktree("stale", "stale_worker"),
        worktree("pending", "pending"),
        worktree("skipped", "skipped"),
        worktree("integrated", "integrated"),
        worktree("idle", null),
      ]),
    ]);
    const { container, dispose } = renderOverview("PRO-1");
    await tick();
    const statuses = Array.from(container.querySelectorAll(".po-worktree-status")).map(
      (node) => node.textContent?.trim()
    );
    expect(statuses).toEqual([
      "working",
      "failed",
      "conflict",
      "stale",
      "pending",
      "skipped",
      "integrated",
      "idle",
    ]);
    dispose();
  });

  it("action buttons call the matching APIs", async () => {
    fetchBoardProjectsMock.mockResolvedValue([
      project("PRO-1", "Alpha Project", "maybe", [
        worktree("running", null, "running"),
        worktree("done", "integrated", "done"),
      ]),
    ]);
    const { container, dispose } = renderOverview("PRO-1");
    await tick();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".po-worktree-actions button"));
    buttons.find((button) => button.textContent === "Logs")?.click();
    await tick();
    buttons.find((button) => button.textContent === "Stop")?.click();
    await tick();
    buttons.find((button) => button.textContent === "Resume")?.click();
    await tick();
    buttons.find((button) => button.textContent === "Open diff")?.click();
    expect(fetchRuntimeSubagentLogsMock).toHaveBeenCalledWith("run-running", 0);
    expect(interruptRuntimeSubagentMock).toHaveBeenCalledWith("run-running");
    expect(resumeRuntimeSubagentMock).toHaveBeenCalledWith(
      "run-done",
      "Continue from the latest state."
    );
    expect(setSearchParamsMock).toHaveBeenCalledWith({ detail: "1" });
    dispose();
  });
});
