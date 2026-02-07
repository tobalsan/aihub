// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { AgentSidebar } from "./AgentSidebar";

vi.mock("../api/client", () => ({
  fetchAgents: vi.fn(async () => []),
  fetchAllSubagents: vi.fn(async () => ({
    items: [
      {
        projectId: "PRO-1",
        slug: "ralph-1",
        cli: "codex",
        status: "idle",
        role: "supervisor",
        groupKey: "PRO-1:ralph-1",
      },
      {
        projectId: "PRO-1",
        slug: "worker-1",
        cli: "codex",
        status: "running",
        role: "worker",
        parentSlug: "ralph-1",
        groupKey: "PRO-1:ralph-1",
      },
      {
        projectId: "PRO-2",
        slug: "beta",
        cli: "claude",
        status: "idle",
      },
    ],
  })),
  fetchAgentStatuses: vi.fn(async () => ({ statuses: {} })),
  subscribeToStatus: vi.fn(() => () => {}),
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AgentSidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("merges ralph supervisor/worker rows and uses dominant status", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [collapsed] = createSignal(false);
    const [selected] = createSignal<string | null>(null);

    const dispose = render(
      () => (
        <AgentSidebar
          collapsed={collapsed}
          onToggleCollapse={() => {}}
          selectedAgent={selected}
          onSelectAgent={() => {}}
        />
      ),
      container
    );

    await tick();
    await tick();

    expect(container.textContent).toContain("PRO-1/codex");
    expect(container.textContent).toContain("PRO-2/claude");
    expect(container.textContent).not.toContain("PRO-1/worker-1");

    const rows = Array.from(container.querySelectorAll(".agent-item"));
    const mergedRow = rows.find((row) =>
      row.textContent?.includes("PRO-1/codex")
    );
    expect(mergedRow?.textContent).toContain("WORKING");

    dispose();
  });
});
