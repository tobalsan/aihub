// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { ProjectListItem } from "../api/types";

// matchMedia must exist before theme.ts module-level code runs
window.matchMedia = vi.fn().mockReturnValue({ matches: false });

const [pathname, setPathname] = createSignal("/projects");
const fetchProjectsMock = vi.fn<() => Promise<ProjectListItem[]>>();

vi.mock("../api/client", () => ({
  fetchProjects: fetchProjectsMock,
}));

vi.mock("@solidjs/router", () => ({
  A: (props: Record<string, unknown>) => <a {...props} />,
  useLocation: () => ({
    get pathname() {
      return pathname();
    },
  }),
}));

const { AgentSidebar } = await import("./AgentSidebar");
const { resetCapabilitiesForTests, setCapabilitiesForTests } = await import(
  "../lib/capabilities"
);

describe("AgentSidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("aihub-theme");
    localStorage.removeItem("aihub:recent-project-views");
    setPathname("/projects");
    fetchProjectsMock.mockReset();
    fetchProjectsMock.mockResolvedValue([]);
    resetCapabilitiesForTests();
    vi.clearAllMocks();
  });

  it("renders sidebar logo and primary navigation links", () => {
    setCapabilitiesForTests({
      components: { projects: true, conversations: true },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [collapsed] = createSignal(false);

    const dispose = render(
      () => (
        <AgentSidebar
          collapsed={collapsed}
          onToggleCollapse={() => {}}
        />
      ),
      container
    );

    expect(container.textContent).toContain("AIHub");
    expect(container.textContent).toContain("Projects");
    expect(container.textContent).toContain("Conversations");
    expect(container.textContent).toContain("Agents");

    dispose();
  });

  it("renders theme toggle button", () => {
    setCapabilitiesForTests({
      components: { projects: true, conversations: true },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [collapsed] = createSignal(false);

    const dispose = render(
      () => (
        <AgentSidebar
          collapsed={collapsed}
          onToggleCollapse={() => {}}
        />
      ),
      container
    );

    const toggle = container.querySelector(".theme-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toMatch(/Light|Dark/);

    dispose();
  });

  it("toggles theme on click", () => {
    setCapabilitiesForTests({
      components: { projects: true, conversations: true },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [collapsed] = createSignal(false);

    const dispose = render(
      () => (
        <AgentSidebar
          collapsed={collapsed}
          onToggleCollapse={() => {}}
        />
      ),
      container
    );

    const toggle = container.querySelector(".theme-toggle") as HTMLButtonElement;
    const initialTheme = document.documentElement.getAttribute("data-theme");
    toggle.click();
    const newTheme = document.documentElement.getAttribute("data-theme");
    expect(newTheme).not.toBe(initialTheme);

    dispose();
  });

  it("renders recents from most recently viewed order", async () => {
    setCapabilitiesForTests({
      components: { projects: true, conversations: true },
    });
    fetchProjectsMock.mockResolvedValue([
      { id: "PRO-1", title: "One", frontmatter: {} },
      { id: "PRO-2", title: "Two", frontmatter: {} },
    ] as ProjectListItem[]);
    localStorage.setItem(
      "aihub:recent-project-views",
      JSON.stringify([{ id: "PRO-1", viewedAt: Date.now() - 60_000 }])
    );
    setPathname("/projects/PRO-2");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const [collapsed] = createSignal(false);

    const dispose = render(
      () => (
        <AgentSidebar
          collapsed={collapsed}
          onToggleCollapse={() => {}}
        />
      ),
      container
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const links = Array.from(
      container.querySelectorAll(".recent-project-link .recent-project-title")
    ).map((node) => node.textContent?.trim());
    expect(links).toEqual(["PRO-2: Two", "PRO-1: One"]);

    const stored = JSON.parse(
      localStorage.getItem("aihub:recent-project-views") ?? "[]"
    );
    expect(stored[0]?.id).toBe("PRO-2");
    expect(stored[1]?.id).toBe("PRO-1");

    dispose();
  });

  it("hides component nav links when capabilities disable them", () => {
    setCapabilitiesForTests({ components: {} });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [collapsed] = createSignal(false);

    const dispose = render(
      () => (
        <AgentSidebar
          collapsed={collapsed}
          onToggleCollapse={() => {}}
        />
      ),
      container
    );

    expect(container.textContent).not.toContain("Projects");
    expect(container.textContent).not.toContain("Conversations");
    expect(container.textContent).toContain("Agents");

    dispose();
  });
});
