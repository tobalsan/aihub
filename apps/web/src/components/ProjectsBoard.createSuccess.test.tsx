// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectsBoard } from "./ProjectsBoard";

const createProjectMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", () => ({
  fetchProjects: vi.fn(async () => []),
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
  createProject: (...args: unknown[]) => createProjectMock(...args),
  fetchAgents: vi.fn(async () => []),
  fetchAllSubagents: vi.fn(async () => ({ items: [] })),
  fetchFullHistory: vi.fn(async () => ({ messages: [] })),
  fetchSubagents: vi.fn(async () => ({ ok: true, data: { items: [] } })),
  fetchSubagentLogs: vi.fn(async () => ({ ok: true, data: { cursor: 0, events: [] } })),
  fetchProjectBranches: vi.fn(async () => ({ ok: true, data: { branches: [] } })),
  uploadAttachments: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("./AgentSidebar", () => ({ AgentSidebar: () => null }));
vi.mock("./ContextPanel", () => ({ ContextPanel: () => null }));
vi.mock("./AgentChat", () => ({ AgentChat: () => null }));
vi.mock("./ActivityFeed", () => ({ ActivityFeed: () => null }));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({}),
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

const openAndSubmit = async (container: HTMLElement) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
  await tick();
  const input = container.querySelector("#create-title") as HTMLInputElement | null;
  if (!input) throw new Error("Missing create title input");
  input.value = "Test Project";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const submit = container.querySelector(".create-submit") as HTMLButtonElement | null;
  if (!submit) throw new Error("Missing create submit button");
  submit.click();
  await tick();
  await tick();
};

describe("ProjectsBoard create success toast", () => {
  beforeEach(() => {
    setupMatchMedia();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("dismisses on click", async () => {
    createProjectMock.mockResolvedValue({
      ok: true,
      data: {
        id: "PRO-1",
        title: "Test Project",
        path: "PRO-1_test",
        absolutePath: "/tmp/PRO-1_test",
        frontmatter: {},
        content: "",
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectsBoard />, container);
    await tick();
    await openAndSubmit(container);
    const overlay = container.querySelector(".create-success");
    expect(overlay).not.toBeNull();
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(container.querySelector(".create-success")).toBeNull();
    dispose();
  });

  it("dismisses on Escape", async () => {
    createProjectMock.mockResolvedValue({
      ok: true,
      data: {
        id: "PRO-2",
        title: "Test Project",
        path: "PRO-2_test",
        absolutePath: "/tmp/PRO-2_test",
        frontmatter: {},
        content: "",
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectsBoard />, container);
    await tick();
    await openAndSubmit(container);
    const overlay = container.querySelector(".create-success");
    expect(overlay).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(container.querySelector(".create-success")).toBeNull();
    dispose();
  });
});
