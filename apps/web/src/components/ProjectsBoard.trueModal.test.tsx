// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { delegateEvents, render } from "solid-js/web";
import { ProjectsBoard } from "./ProjectsBoard";

const { routerState } = vi.hoisted(() => ({
  routerState: {
    project: undefined as string | undefined,
    backStack: [undefined as string | undefined],
    index: 0,
  },
}));

vi.mock("@solidjs/router", () => ({
  useSearchParams: () => {
    const [project, setProject] = createSignal<string | undefined>(
      routerState.project
    );
    const onPopState = () => setProject(routerState.project);
    window.addEventListener("popstate", onPopState);
    const set = (next: { project?: string | undefined }) => {
      const nextProject = next.project;
      routerState.project = nextProject;
      routerState.backStack = routerState.backStack.slice(
        0,
        routerState.index + 1
      );
      routerState.backStack.push(nextProject);
      routerState.index = routerState.backStack.length - 1;
      setProject(nextProject);
    };
    const params = {} as { readonly project?: string };
    Object.defineProperty(params, "project", {
      get: () => project(),
    });
    return [params, set] as const;
  },
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
    frontmatter: {
      status: "maybe",
      domain: "coding",
      executionMode: "subagent",
    },
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
vi.mock("./ContextPanel", () => ({
  ContextPanel: () => {
    const [draft, setDraft] = createSignal("");
    return (
      <input
        data-testid="sidebar-draft"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
      />
    );
  },
}));
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
  if (window.requestAnimationFrame) return;
  window.requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
};

describe("ProjectsBoard true modal", () => {
  beforeEach(() => {
    delegateEvents(["click", "input", "keydown"]);
    setupMatchMedia();
    setupRaf();
    localStorage.clear();
    localStorage.setItem(
      "aihub:projects:expanded-columns",
      JSON.stringify(["maybe", "not_now"])
    );
    routerState.project = undefined;
    routerState.backStack = [undefined];
    routerState.index = 0;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("keeps board and sidebar draft state across open/close and back/forward", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectsBoard />, container);

    await tick();
    await tick();

    const filterInput = container.querySelector(
      ".filter-input"
    ) as HTMLInputElement;
    filterInput.value = "alpha";
    filterInput.dispatchEvent(new Event("input", { bubbles: true }));

    const chatDraft = container.querySelector(
      '[data-testid="sidebar-draft"]'
    ) as HTMLInputElement;
    chatDraft.value = "keep me";
    chatDraft.dispatchEvent(new Event("input", { bubbles: true }));

    const columnBody = container.querySelector(
      ".column-body"
    ) as HTMLDivElement;
    columnBody.scrollTop = 180;

    const card = container.querySelector(".card") as HTMLDivElement;
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    expect(container.querySelector(".overlay")).not.toBeNull();
    expect(routerState.project).toBe("PRO-1");

    const closeButton = container.querySelector(
      ".overlay-close"
    ) as HTMLButtonElement;
    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    expect(container.querySelector(".overlay")).toBeNull();
    expect(
      (container.querySelector(".filter-input") as HTMLInputElement).value
    ).toBe("alpha");
    expect(
      (
        container.querySelector(
          '[data-testid="sidebar-draft"]'
        ) as HTMLInputElement
      ).value
    ).toBe("keep me");
    const columnBodyAfterClose = container.querySelector(
      ".column-body"
    ) as HTMLDivElement;
    expect(columnBodyAfterClose).toBe(columnBody);
    expect(columnBodyAfterClose.scrollTop).toBe(180);

    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(container.querySelector(".overlay")).not.toBeNull();

    routerState.index -= 1;
    routerState.project = routerState.backStack[routerState.index];
    window.dispatchEvent(new PopStateEvent("popstate"));
    await tick();
    await tick();
    expect(container.querySelector(".overlay")).toBeNull();

    routerState.index += 1;
    routerState.project = routerState.backStack[routerState.index];
    window.dispatchEvent(new PopStateEvent("popstate"));
    await tick();
    await tick();
    expect(container.querySelector(".overlay")).not.toBeNull();
    expect(
      (container.querySelector(".filter-input") as HTMLInputElement).value
    ).toBe("alpha");
    expect(
      (
        container.querySelector(
          '[data-testid="sidebar-draft"]'
        ) as HTMLInputElement
      ).value
    ).toBe("keep me");

    dispose();
  });
});
