// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { ProjectsBoard } from "./ProjectsBoard";

const { fetchSubagentLogsMock } = vi.hoisted(() => ({
  fetchSubagentLogsMock: vi.fn(async (_projectId: string, _slug: string) => ({
    ok: true,
    data: { cursor: 1, events: [] },
  })),
}));

vi.mock("../api/client", () => ({
  fetchProjects: vi.fn(async () => [
    {
      id: "PRO-1",
      title: "Grouped Runs",
      path: "PRO-1_grouped-runs",
      absolutePath: "/tmp/PRO-1_grouped-runs",
      frontmatter: { status: "in_progress" },
    },
  ]),
  fetchArchivedProjects: vi.fn(async () => []),
  fetchProject: vi.fn(async () => ({
    id: "PRO-1",
    title: "Grouped Runs",
    path: "PRO-1_grouped-runs",
    absolutePath: "/tmp/PRO-1_grouped-runs",
    frontmatter: { status: "in_progress", executionMode: "subagent" },
    docs: {},
    thread: [],
  })),
  updateProject: vi.fn(async () => ({})),
  deleteProject: vi.fn(async () => ({})),
  archiveProject: vi.fn(async () => ({})),
  unarchiveProject: vi.fn(async () => ({})),
  createProject: vi.fn(async () => ({ ok: true, data: {} })),
  fetchAgents: vi.fn(async () => []),
  fetchAllSubagents: vi.fn(async () => ({ items: [] })),
  fetchFullHistory: vi.fn(async () => ({ messages: [] })),
  fetchSubagents: vi.fn(async () => ({
    ok: true,
    data: {
      items: [
        {
          slug: "ralph-1",
          type: "ralph_loop",
          cli: "codex",
          role: "supervisor",
          groupKey: "PRO-1:ralph-1",
          status: "idle",
          iterations: 5,
        },
        {
          slug: "worker-1",
          type: "subagent",
          cli: "codex",
          role: "worker",
          parentSlug: "ralph-1",
          groupKey: "PRO-1:ralph-1",
          status: "running",
        },
      ],
    },
  })),
  fetchSubagentLogs: fetchSubagentLogsMock,
  fetchProjectBranches: vi.fn(async () => ({
    ok: true,
    data: { branches: [] },
  })),
  killSubagent: vi.fn(async () => ({ ok: true })),
  archiveSubagent: vi.fn(async () => ({ ok: true })),
  unarchiveSubagent: vi.fn(async () => ({ ok: true })),
  interruptSubagent: vi.fn(async () => ({ ok: true })),
  uploadAttachments: vi.fn(async () => ({ ok: true, data: [] })),
  addProjectComment: vi.fn(async () => ({})),
  updateProjectComment: vi.fn(async () => ({})),
  deleteProjectComment: vi.fn(async () => ({})),
  startProjectRun: vi.fn(async () => ({ ok: true })),
  spawnRalphLoop: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./AgentSidebar", () => ({ AgentSidebar: () => null }));
vi.mock("./ContextPanel", () => ({ ContextPanel: () => null }));
vi.mock("./AgentChat", () => ({ AgentChat: () => null }));
vi.mock("./ActivityFeed", () => ({ ActivityFeed: () => null }));

vi.mock("@solidjs/router", () => ({
  useSearchParams: () => [{ project: "PRO-1" }, () => {}],
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const setupMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const setupRaf = () => {
  if (window.requestAnimationFrame) return;
  window.requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
};

describe("ProjectsBoard ralph grouping", () => {
  beforeEach(() => {
    delegateEvents(["click", "input", "keydown"]);
    setupMatchMedia();
    setupRaf();
    localStorage.clear();
    fetchSubagentLogsMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders grouped parent/child rows and switches log source by selection", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectsBoard />, container);

    await tick();
    await tick();
    await tick();

    const runRows = Array.from(container.querySelectorAll(".run-row"));
    expect(runRows.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".run-row.nested")).not.toBeNull();
    expect(container.textContent).toContain("WORKING");

    const supervisorRow = runRows.find((row) =>
      row.textContent?.includes("PRO-1/codex")
    );
    expect(supervisorRow).toBeTruthy();
    supervisorRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(fetchSubagentLogsMock).toHaveBeenCalledWith("PRO-1", "ralph-1", 0);

    const workerRow = runRows.find((row) =>
      row.textContent?.includes("worker-1")
    );
    expect(workerRow).toBeTruthy();
    workerRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(fetchSubagentLogsMock).toHaveBeenCalledWith("PRO-1", "worker-1", 0);

    dispose();
  });
});
