// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { updateProject } from "../../api/client";

const navigateMock = vi.fn();

vi.mock("@solidjs/router", () => ({
  useParams: () => ({ id: "PRO-1" }),
  useNavigate: () => navigateMock,
}));

vi.mock("../../api/client", () => ({
  fetchProject: vi.fn(async () => ({
    id: "PRO-1",
    title: "Alpha Project",
    path: "PRO-1_alpha-project",
    absolutePath: "/tmp/PRO-1_alpha-project",
    frontmatter: { area: "aihub", status: "todo" },
    docs: {},
    thread: [],
  })),
  fetchAreas: vi.fn(async () => [
    { id: "aihub", title: "AIHub", color: "#53b97c" },
  ]),
  fetchTasks: vi.fn(async () => ({
    tasks: [
      {
        title: "Route setup",
        status: "todo",
        checked: false,
        order: 0,
      },
    ],
    progress: { done: 0, total: 1 },
  })),
  fetchSpec: vi.fn(async () => ({ content: "# Title" })),
  addProjectComment: vi.fn(async () => ({})),
  updateProject: vi.fn(async () => ({})),
  updateTask: vi.fn(async () => ({})),
  createTask: vi.fn(async () => ({})),
  saveSpec: vi.fn(async () => ({})),
  fetchSubagents: vi.fn(async () => ({ ok: true, data: { items: [] } })),
  fetchSubagentLogs: vi.fn(async () => ({
    ok: true,
    data: { cursor: 0, events: [] },
  })),
  spawnSubagent: vi.fn(async () => ({ ok: true, data: { slug: "alpha" } })),
}));

describe("ProjectDetailPage", () => {
  it("navigates to /projects when Back to Projects is clicked", async () => {
    navigateMock.mockReset();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectDetailPage />, container);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const backButton = container.querySelector(
      ".project-detail-back"
    ) as HTMLButtonElement;
    backButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(navigateMock).toHaveBeenCalledWith("/projects");

    dispose();
  });

  it("renders three-column shell and breadcrumb", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectDetailPage />, container);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".project-detail")).not.toBeNull();
    expect(container.querySelector(".project-detail__left")).not.toBeNull();
    expect(container.querySelector(".project-detail__center")).not.toBeNull();
    expect(container.querySelector(".project-detail__right")).not.toBeNull();
    expect(container.textContent).toContain("Back to Projects");
    expect(container.textContent).toContain("AIHub");
    expect(container.textContent).toContain("Alpha Project");

    dispose();
  });

  it("allows inline title edit on double-click and updates breadcrumb after save", async () => {
    vi.mocked(updateProject).mockClear();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ProjectDetailPage />, container);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const titleEl = container.querySelector(
      ".project-detail-title"
    ) as HTMLSpanElement;
    titleEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const input = container.querySelector(
      ".project-detail-title-input"
    ) as HTMLInputElement;
    input.value = "Renamed Project";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const saveButton = container.querySelector(
      ".project-detail-title-save"
    ) as HTMLButtonElement;
    saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(updateProject).toHaveBeenCalledWith("PRO-1", {
      title: "Renamed Project",
    });
    expect(
      container.querySelector(".project-detail-breadcrumb")?.textContent
    ).toContain("Renamed Project");

    dispose();
  });
});
