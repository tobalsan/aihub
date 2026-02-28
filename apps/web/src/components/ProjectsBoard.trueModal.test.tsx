// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { delegateEvents, render } from "solid-js/web";
import { ProjectsBoard } from "./ProjectsBoard";

const navigateMock = vi.fn();

vi.mock("@solidjs/router", () => ({
  useSearchParams: () => {
    const [project] = createSignal<string | undefined>(undefined);
    const params = {} as { readonly project?: string };
    Object.defineProperty(params, "project", {
      get: () => project(),
    });
    return [params, () => {}] as const;
  },
  useNavigate: () => navigateMock,
  A: (props: Record<string, unknown>) => <a {...props} />,
}));

vi.mock("../api/client", () => ({
  fetchProjects: vi.fn(async () => [
    {
      id: "PRO-1",
      title: "Alpha Project",
      path: "PRO-1_alpha-project",
      absolutePath: "/tmp/PRO-1_alpha-project",
      frontmatter: { status: "maybe", domain: "coding" },
    },
  ]),
  fetchArchivedProjects: vi.fn(async () => []),
  fetchProject: vi.fn(async () => ({
    id: "PRO-1",
    title: "Alpha Project",
    path: "PRO-1_alpha-project",
    absolutePath: "/tmp/PRO-1_alpha-project",
    frontmatter: {},
    docs: { README: "Project details" },
    thread: [],
  })),
  updateProject: vi.fn(async () => ({})),
  deleteProject: vi.fn(async () => ({ ok: true })),
  archiveProject: vi.fn(async () => ({ ok: true })),
  unarchiveProject: vi.fn(async () => ({ ok: true })),
  createProject: vi.fn(async () => ({
    ok: true,
    data: { id: "PRO-2", title: "New" },
  })),
  fetchAgents: vi.fn(async () => []),
  fetchAllSubagents: vi.fn(async () => ({ items: [] })),
  fetchFullHistory: vi.fn(async () => ({ messages: [] })),
  fetchSubagents: vi.fn(async () => ({ ok: true, data: { items: [] } })),
  fetchSubagentLogs: vi.fn(async () => ({
    ok: true,
    data: { cursor: 0, events: [] },
  })),
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
vi.mock("./ActivityFeed", () => ({ ActivityFeed: () => null }));
vi.mock("./AgentChat", () => ({ AgentChat: () => null }));

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
  window.requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
};

describe("ProjectsBoard card navigation", () => {
  beforeEach(() => {
    delegateEvents(["click", "input", "keydown"]);
    setupMatchMedia();
    setupRaf();
    localStorage.clear();
    localStorage.setItem(
      "aihub:projects:expanded-columns",
      JSON.stringify(["maybe", "not_now"])
    );
  });

  afterEach(() => {
    navigateMock.mockReset();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("navigates to detail route on project click", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectsBoard />, container);

    await tick();
    await tick();

    const card = container.querySelector(".card") as HTMLDivElement;
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(navigateMock).toHaveBeenCalledWith("/projects/PRO-1");

    dispose();
  });
});
