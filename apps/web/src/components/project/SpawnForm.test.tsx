// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { ProjectDetail, SubagentListItem } from "../../api/types";
import { spawnSubagent } from "../../api/client";
import { SpawnForm, buildReviewerWorkspaceList } from "./SpawnForm";

vi.mock("../../api/client", () => ({
  spawnSubagent: vi.fn(async () => ({ ok: true, data: { slug: "worker-1" } })),
}));

const project: ProjectDetail = {
  id: "PRO-149",
  title: "Spawn templates",
  path: "PRO-149_spawn",
  absolutePath: "/tmp/PRO-149_spawn",
  repoValid: true,
  frontmatter: {},
  docs: {},
  thread: [],
};

describe("SpawnForm", () => {
  it("applies coordinator prefill including none mode", async () => {
    const onSpawned = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpawnForm
          projectId={project.id}
          project={project}
          template="coordinator"
          prefill={{
            name: "Coordinator",
            cli: "claude",
            model: "opus",
            reasoning: "medium",
            runMode: "none",
            includeDefaultPrompt: true,
            includePostRun: false,
          }}
          subagents={[]}
          onSpawned={onSpawned}
          onCancel={() => {}}
        />
      ),
      container
    );

    const selectValues = Array.from(
      container.querySelectorAll(".add-agent-select")
    ).map((item) => (item as HTMLSelectElement).value);

    expect(
      (container.querySelector(".add-agent-input") as HTMLInputElement).value
    ).toBe("Coordinator");
    expect(selectValues[0]).toBe("claude");
    expect(selectValues[1]).toBe("opus");
    expect(selectValues[2]).toBe("medium");
    expect(selectValues[3]).toBe("none");

    const submit = container.querySelector(
      ".add-agent-submit"
    ) as HTMLButtonElement;
    submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spawnSubagent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnSubagent).mock.calls[0]?.[1]).toMatchObject({
      cli: "claude",
      model: "opus",
      reasoningEffort: "medium",
      mode: "none",
      name: "Coordinator",
    });
    expect(onSpawned).toHaveBeenCalledWith("worker-1");

    dispose();
  });

  it("builds reviewer workspace section from active worker subagents", async () => {
    vi.mocked(spawnSubagent).mockClear();
    const subagents: SubagentListItem[] = [
      {
        slug: "worker-alpha",
        name: "Worker Alpha",
        cli: "codex",
        status: "running",
        runMode: "clone",
      },
      {
        slug: "worker-main",
        name: "Worker Main",
        cli: "codex",
        status: "running",
        runMode: "main-run",
      },
      {
        slug: "worker-beta",
        name: "Worker Beta",
        cli: "claude",
        status: "idle",
        runMode: "worktree",
      },
      {
        slug: "observer",
        name: "Observer",
        cli: "claude",
        status: "replied",
        runMode: "none",
      },
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpawnForm
          projectId={project.id}
          project={project}
          template="reviewer"
          prefill={{
            name: "Reviewer Delta",
            cli: "codex",
            model: "gpt-5.3-codex",
            reasoning: "medium",
            runMode: "none",
            includeDefaultPrompt: true,
            includePostRun: false,
          }}
          subagents={subagents}
          onSpawned={() => {}}
          onCancel={() => {}}
        />
      ),
      container
    );

    const submit = container.querySelector(
      ".add-agent-submit"
    ) as HTMLButtonElement;
    submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const payload = vi.mocked(spawnSubagent).mock.calls[0]?.[1];
    expect(payload?.mode).toBe("none");
    expect(payload?.prompt).toContain("## Your Role: Reviewer");
    expect(payload?.prompt).toContain("## Active Worker Workspaces");
    expect(payload?.prompt).toContain(
      "~/projects/.workspaces/PRO-149/worker-alpha/"
    );
    expect(payload?.prompt).toContain(
      "~/projects/.workspaces/PRO-149/worker-beta/"
    );
    expect(payload?.prompt).not.toContain("worker-main");

    dispose();
  });

  it("uses clone/worktree workspace path in worker implementation repo prompt", async () => {
    vi.mocked(spawnSubagent).mockClear();
    const projectWithRepo: ProjectDetail = {
      ...project,
      frontmatter: {
        repo: "~/code/aihub",
      },
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpawnForm
          projectId={projectWithRepo.id}
          project={projectWithRepo}
          template="worker"
          prefill={{
            cli: "codex",
            model: "gpt-5.3-codex",
            reasoning: "medium",
            runMode: "clone",
          }}
          subagents={[]}
          onSpawned={() => {}}
          onCancel={() => {}}
        />
      ),
      container
    );

    const submit = container.querySelector(
      ".add-agent-submit"
    ) as HTMLButtonElement;
    submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const payload = vi.mocked(spawnSubagent).mock.calls[0]?.[1];
    expect(payload?.mode).toBe("clone");
    expect(payload?.prompt).toContain(
      `Path: ~/projects/.workspaces/${projectWithRepo.id}/`
    );
    expect(payload?.prompt).not.toContain("Path: ~/code/aihub");

    dispose();
  });

  it("hides custom instructions by default and excludes when unchecked", async () => {
    vi.mocked(spawnSubagent).mockClear();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpawnForm
          projectId={project.id}
          project={project}
          template="custom"
          prefill={{
            customInstructions: "Prefill custom text",
          }}
          subagents={[]}
          onSpawned={() => {}}
          onCancel={() => {}}
        />
      ),
      container
    );

    expect(container.querySelector(".add-agent-prompt")).toBeNull();

    const toggle = container.querySelector(
      ".custom-instructions-toggle"
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const promptArea = container.querySelector(
      ".add-agent-prompt"
    ) as HTMLTextAreaElement;
    expect(promptArea).not.toBeNull();
    promptArea.value = "Custom hidden text should not be used";
    promptArea.dispatchEvent(new Event("input", { bubbles: true }));

    toggle.checked = false;
    toggle.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector(".add-agent-prompt")).toBeNull();

    const submit = container.querySelector(
      ".add-agent-submit"
    ) as HTMLButtonElement;
    submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const payload = vi.mocked(spawnSubagent).mock.calls[0]?.[1];
    expect(payload?.prompt).not.toContain("Custom hidden text should not be used");
    expect(payload?.prompt).not.toContain("Prefill custom text");

    dispose();
  });

  it("updates custom template preview when toggles change", async () => {
    vi.mocked(spawnSubagent).mockClear();

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpawnForm
          projectId={project.id}
          project={project}
          template="custom"
          prefill={{}}
          subagents={[]}
          onSpawned={() => {}}
          onCancel={() => {}}
        />
      ),
      container
    );

    const preview = container.querySelector(".add-agent-preview pre");
    expect(preview?.textContent).toContain(
      "## IMPORTANT: MUST DO AFTER IMPLEMENTATION"
    );

    const defaultToggle = container.querySelector(
      ".project-context-toggle"
    ) as HTMLInputElement;
    const roleToggle = container.querySelector(
      ".role-instructions-toggle"
    ) as HTMLInputElement;
    const postRunToggle = container.querySelector(
      ".post-run-toggle"
    ) as HTMLInputElement;

    postRunToggle.checked = false;
    postRunToggle.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preview?.textContent).not.toContain(
      "## IMPORTANT: MUST DO AFTER IMPLEMENTATION"
    );
    expect(preview?.textContent).toContain("## Your Role");

    defaultToggle.checked = false;
    defaultToggle.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preview?.textContent).toContain("## Your Role");

    roleToggle.checked = false;
    roleToggle.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preview?.textContent).toContain("(empty)");

    dispose();
  });

  it("updates worker preview when role instructions toggle changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpawnForm
          projectId={project.id}
          project={project}
          template="worker"
          prefill={{}}
          subagents={[]}
          onSpawned={() => {}}
          onCancel={() => {}}
        />
      ),
      container
    );

    const preview = container.querySelector(".add-agent-preview pre");
    expect(preview?.textContent).toContain("## Your Role: Worker");

    const roleToggle = container.querySelector(
      ".role-instructions-toggle"
    ) as HTMLInputElement;
    roleToggle.checked = false;
    roleToggle.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(preview?.textContent).not.toContain("## Your Role: Worker");

    dispose();
  });
});

describe("buildReviewerWorkspaceList", () => {
  it("returns fallback when no active worker workspaces", () => {
    expect(
      buildReviewerWorkspaceList("PRO-149", [
        { slug: "x", status: "running", runMode: "none" },
      ])
    ).toBe("No active worker workspaces found.");
  });

  it("includes clone/worktree workers regardless status", () => {
    const result = buildReviewerWorkspaceList("PRO-149", [
      { slug: "worker-a", status: "idle", runMode: "clone" },
      { slug: "worker-b", status: "error", runMode: "worktree" },
      { slug: "reviewer", status: "running", runMode: "none" },
      { slug: "space-run", status: "running", runMode: "main-run" },
    ]);

    expect(result).toContain("worker-a");
    expect(result).toContain("worker-b");
    expect(result).not.toContain("reviewer");
    expect(result).not.toContain("space-run");
  });
});
