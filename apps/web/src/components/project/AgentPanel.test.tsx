// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import type { ProjectDetail, SubagentListItem } from "../../api/types";
import { AgentPanel } from "./AgentPanel";
import { fetchSubagents } from "../../api/client";

vi.mock("../../api/client", () => ({
  fetchSubagents: vi.fn(async () => ({ ok: true, data: { items: [] } })),
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
  const setup = (options?: {
    onSelectAgent?: (input: unknown) => void;
    onOpenSpawn?: (input: unknown) => void;
  }) => {
    const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <AgentPanel
          project={project}
          area={undefined}
          areas={[]}
          subagents={subagents()}
          onSubagentsChange={(items) => setSubagents(items)}
          onOpenSpawn={(input) => options?.onOpenSpawn?.(input)}
          onTitleChange={() => {}}
          onStatusChange={() => {}}
          onAreaChange={() => {}}
          onRepoChange={() => {}}
          selectedAgentSlug={null}
          onSelectAgent={(info) => options?.onSelectAgent?.(info)}
        />
      ),
      container
    );
    return { container, dispose };
  };

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
    const { container, dispose } = setup({ onSelectAgent });

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

  it("opens template menu and emits worker prefill", async () => {
    vi.mocked(fetchSubagents).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            slug: "alpha",
            cli: "codex",
            status: "running",
            name: "Worker Alpha",
          },
        ],
      },
    });
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.1);
    const onOpenSpawn = vi.fn();

    const { container, dispose } = setup({ onOpenSpawn });

    const openButton = container.querySelector(
      ".add-agent-btn"
    ) as HTMLButtonElement;
    openButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const workerOption = Array.from(
      container.querySelectorAll(".template-option")
    ).find((item) => item.textContent?.includes("Worker")) as HTMLButtonElement;
    workerOption.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onOpenSpawn).toHaveBeenCalledTimes(1);
    const payload = onOpenSpawn.mock.calls[0]?.[0];
    expect(payload.template).toBe("worker");
    expect(payload.prefill).toMatchObject({
      cli: "codex",
      model: "gpt-5.3-codex",
      reasoning: "medium",
      runMode: "clone",
      includeDefaultPrompt: true,
      includePostRun: true,
    });
    expect(payload.prefill.name).not.toBe("Worker Alpha");

    expect(container.querySelector(".template-menu")).toBeNull();

    randSpy.mockRestore();
    dispose();
  });

  it("shows all four template options", async () => {
    vi.mocked(fetchSubagents).mockResolvedValue({
      ok: true,
      data: { items: [] },
    });

    const { container, dispose } = setup();
    const openButton = container.querySelector(
      ".add-agent-btn"
    ) as HTMLButtonElement;
    openButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    const text = container.textContent ?? "";
    expect(text).toContain("Coordinator");
    expect(text).toContain("Worker");
    expect(text).toContain("Reviewer");
    expect(text).toContain("Custom");

    dispose();
  });

  it("toggles repo block and allows repo editing", async () => {
    const projectWithRepo: ProjectDetail = {
      ...project,
      frontmatter: {
        ...project.frontmatter,
        repo: "~/code/aihub",
      },
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <AgentPanel
          project={projectWithRepo}
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

    expect(container.querySelector(".repo-row")).toBeNull();

    const toggle = container.querySelector(
      ".repo-toggle-btn"
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const repoValue = container.querySelector(".repo-value") as HTMLParagraphElement;
    expect(repoValue).toBeTruthy();
    expect(repoValue.textContent).toContain("~/code/aihub");

    repoValue.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector(".repo-input")).not.toBeNull();

    dispose();
  });
});
