// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { ProjectsBoard } from "./ProjectsBoard";

vi.mock("../api/client", () => ({
  fetchProjects: vi.fn(() => []),
  fetchProject: vi.fn(async () => ({
    id: "PRO-0",
    title: "Mock",
    path: "PRO-0_mock",
    absolutePath: "/tmp/PRO-0_mock",
    frontmatter: {},
    content: "",
  })),
  updateProject: vi.fn(async () => ({
    id: "PRO-0",
    title: "Mock",
    path: "PRO-0_mock",
    absolutePath: "/tmp/PRO-0_mock",
    frontmatter: {},
    content: "",
  })),
  createProject: vi.fn(async () => ({
    ok: true,
    data: {
      id: "PRO-0",
      title: "Test Project",
      path: "PRO-0_test",
      absolutePath: "/tmp/PRO-0_test",
      frontmatter: {},
      content: "",
    },
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
  uploadAttachments: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("./AgentSidebar", () => ({ AgentSidebar: () => null }));
vi.mock("./ContextPanel", () => ({ ContextPanel: () => null }));
vi.mock("./AgentChat", () => ({ AgentChat: () => null }));
vi.mock("./ActivityFeed", () => ({ ActivityFeed: () => null }));

vi.mock("@solidjs/router", () => ({
  useSearchParams: () => [{}, () => {}],
  A: (props: Record<string, unknown>) => <a {...props} />,
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

const triggerCreateSuccess = async (title: string) => {
  const api = (
    window as unknown as {
      __aihubTest?: { setCreateSuccess: (value: string) => void };
    }
  ).__aihubTest;
  if (!api?.setCreateSuccess) {
    throw new Error("Missing test API for create success");
  }
  api.setCreateSuccess(title);
  await tick();
};

describe("ProjectsBoard create success toast", () => {
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
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("dismisses on click", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectsBoard />, container);
    await tick();
    await triggerCreateSuccess("Test Project");
    const overlay = document.querySelector(".create-success");
    expect(overlay).not.toBeNull();
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(container.querySelector(".create-success")).toBeNull();
    dispose();
  });

  it("dismisses on Escape", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectsBoard />, container);
    await tick();
    await triggerCreateSuccess("Test Project");
    const overlay = document.querySelector(".create-success");
    expect(overlay).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(container.querySelector(".create-success")).toBeNull();
    dispose();
  });
});
