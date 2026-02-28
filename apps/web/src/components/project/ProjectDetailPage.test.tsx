// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectDetailPage } from "./ProjectDetailPage";

vi.mock("@solidjs/router", () => ({
  useParams: () => ({ id: "PRO-1" }),
  useNavigate: () => vi.fn(),
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
    tasks: [],
    progress: { done: 0, total: 0 },
  })),
  fetchSpec: vi.fn(async () => ({ content: "# Title" })),
  updateProject: vi.fn(async () => ({})),
  updateTask: vi.fn(async () => ({})),
  createTask: vi.fn(async () => ({})),
  saveSpec: vi.fn(async () => ({})),
}));

describe("ProjectDetailPage", () => {
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
});
