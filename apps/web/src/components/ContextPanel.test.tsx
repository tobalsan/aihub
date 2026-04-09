// @vitest-environment jsdom
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ContextPanel } from "./ContextPanel";

vi.mock("../api/client", () => ({
  fetchAgents: vi.fn(async () => []),
  fetchAllSubagents: vi.fn(async () => ({ items: [] })),
  fetchProjects: vi.fn(async () => [
    { id: "PRO-1", title: "Alpha", frontmatter: {} },
  ]),
}));

vi.mock("../lib/capabilities", () => ({
  isComponentEnabled: () => true,
}));

vi.mock("./ActivityFeed", () => ({ ActivityFeed: () => null }));
vi.mock("./AgentChat", () => ({ AgentChat: () => null }));
vi.mock("./AgentDirectory", () => ({ AgentDirectory: () => null }));
vi.mock("@solidjs/router", () => ({
  A: (props: Record<string, unknown>) => <a {...props} />,
  useLocation: () => ({ pathname: "/projects/PRO-1" }),
}));

describe("ContextPanel", () => {
  it("renders recent projects at the bottom", async () => {
    localStorage.setItem("aihub:context-panel:mode", "agents");
    localStorage.setItem(
      "aihub:recent-project-views",
      JSON.stringify([{ id: "PRO-1", viewedAt: Date.now() }])
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <ContextPanel
          collapsed={() => false}
          onToggleCollapse={() => {}}
          selectedAgent={() => null}
          onSelectAgent={() => {}}
          onClearSelection={() => {}}
          onOpenProject={() => {}}
        />
      ),
      container
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector(".panel-recent-label")?.textContent).toBe(
      "Recent"
    );
    expect(
      (container.querySelector(".recent-project-link") as HTMLAnchorElement)
        ?.getAttribute("href")
    ).toBe("/projects/PRO-1");

    dispose();
    localStorage.removeItem("aihub:context-panel:mode");
    localStorage.removeItem("aihub:recent-project-views");
  });

  it("hides recent projects outside the Agents tab", async () => {
    localStorage.setItem("aihub:context-panel:mode", "chat");
    localStorage.setItem(
      "aihub:recent-project-views",
      JSON.stringify([{ id: "PRO-1", viewedAt: Date.now() }])
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <ContextPanel
          collapsed={() => false}
          onToggleCollapse={() => {}}
          selectedAgent={() => null}
          onSelectAgent={() => {}}
          onClearSelection={() => {}}
          onOpenProject={() => {}}
        />
      ),
      container
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector(".panel-recent")).toBeNull();

    dispose();
    localStorage.removeItem("aihub:context-panel:mode");
    localStorage.removeItem("aihub:recent-project-views");
  });

  it("does not force-switch back to chat when reopening Agents for the same selection", async () => {
    localStorage.setItem("aihub:context-panel:mode", "chat");
    const [selectedAgent] = createSignal("lead-1");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <ContextPanel
          collapsed={() => false}
          onToggleCollapse={() => {}}
          selectedAgent={selectedAgent}
          onSelectAgent={() => {}}
          onClearSelection={() => {}}
          onOpenProject={() => {}}
        />
      ),
      container
    );

    await Promise.resolve();
    await Promise.resolve();

    const agentsTab = Array.from(
      container.querySelectorAll(".panel-tabs button")
    ).find((button) => button.textContent === "Agents") as HTMLButtonElement;
    agentsTab.click();
    await Promise.resolve();

    expect(agentsTab.classList.contains("active")).toBe(true);
    expect(container.querySelector(".panel-recent")).not.toBeNull();

    dispose();
    localStorage.removeItem("aihub:context-panel:mode");
  });
});
