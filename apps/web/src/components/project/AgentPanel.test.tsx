// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { ProjectDetail } from "../../api/types";
import { AgentPanel } from "./AgentPanel";
import { fetchSubagents, spawnSubagent } from "../../api/client";

vi.mock("../../api/client", () => ({
  fetchSubagents: vi.fn(async () => ({ ok: true, data: { items: [] } })),
  spawnSubagent: vi.fn(async () => ({ ok: true, data: { slug: "codex-abc" } })),
  archiveSubagent: vi.fn(async () => ({
    ok: true,
    data: { slug: "codex-abc", archived: true },
  })),
  killSubagent: vi.fn(async () => ({ ok: true, data: { slug: "codex-abc" } })),
}));

const project: ProjectDetail = {
  id: "PRO-1",
  title: "Alpha Project",
  path: "PRO-1_alpha-project",
  absolutePath: "/tmp/PRO-1_alpha-project",
  frontmatter: {
    status: "todo",
    created: "2026-02-28T20:00:00.000Z",
    sessionKeys: { "lead-agent": "main" },
  },
  docs: {},
  thread: [],
};

describe("AgentPanel", () => {
  it("renders agent rows and selects subagent on click", async () => {
    vi.mocked(fetchSubagents).mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            slug: "alpha",
            cli: "codex",
            status: "running",
          },
        ],
      },
    });
    const onSelectAgent = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <AgentPanel
          project={project}
          area={undefined}
          areas={[]}
          onTitleChange={() => {}}
          onStatusChange={() => {}}
          onAreaChange={() => {}}
          onRepoChange={() => {}}
          selectedAgentSlug={null}
          onSelectAgent={onSelectAgent}
        />
      ),
      container
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain("lead-agent");
    const row = Array.from(container.querySelectorAll(".agent-list-item")).find(
      (item) => item.textContent?.includes("codex")
    ) as HTMLButtonElement | undefined;
    expect(row).toBeDefined();

    row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectAgent).toHaveBeenCalledWith({
      type: "subagent",
      slug: "alpha",
      cli: "codex",
      status: "running",
      projectId: "PRO-1",
    });

    dispose();
  });

  it("spawns prepared subagent from add-agent form", async () => {
    vi.mocked(fetchSubagents).mockResolvedValue({
      ok: true,
      data: { items: [] },
    });
    vi.mocked(spawnSubagent).mockResolvedValueOnce({
      ok: true,
      data: { slug: "codex-123" },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <AgentPanel
          project={project}
          area={undefined}
          areas={[]}
          onTitleChange={() => {}}
          onStatusChange={() => {}}
          onAreaChange={() => {}}
          onRepoChange={() => {}}
          selectedAgentSlug={null}
          onSelectAgent={() => {}}
        />
      ),
      container
    );

    const openButton = container.querySelector(
      ".add-agent-btn"
    ) as HTMLButtonElement;
    openButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const nameInput = container.querySelector(
      ".add-agent-input"
    ) as HTMLInputElement;
    nameInput.value = "Coordinator";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const prompt = container.querySelector(
      ".add-agent-prompt"
    ) as HTMLTextAreaElement;
    prompt.value = "Do task B";
    prompt.dispatchEvent(new Event("input", { bubbles: true }));

    const submit = container.querySelector(
      ".add-agent-submit"
    ) as HTMLButtonElement;
    submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spawnSubagent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnSubagent).mock.calls[0]?.[0]).toBe("PRO-1");
    expect(vi.mocked(spawnSubagent).mock.calls[0]?.[1]).toMatchObject({
      cli: "codex",
      name: "Coordinator",
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
      mode: "clone",
    });
    const payload = vi.mocked(spawnSubagent).mock.calls[0]?.[1];
    expect(payload?.prompt).toContain("Review the full project context");
    expect(payload?.prompt).toContain("When done, run relevant tests.");
    expect(payload?.prompt).toContain("Do task B");

    dispose();
  });
});
