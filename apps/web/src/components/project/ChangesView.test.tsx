// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ChangesView } from "./ChangesView";
import type {
  ProjectChanges,
  ProjectPullRequestTarget,
  ProjectSpaceState,
  SpaceContribution,
} from "../../api/types";

const mocks = vi.hoisted(() => ({
  fetchProjectChanges: vi.fn<(projectId: string) => Promise<ProjectChanges>>(),
  fetchProjectSpace: vi.fn<(projectId: string) => Promise<ProjectSpaceState>>(),
  fetchProjectSpaceCommits:
    vi.fn<
      (
        projectId: string
      ) => Promise<
        Array<{ sha: string; subject: string; author: string; date: string }>
      >
    >(),
  fetchProjectPullRequestTarget:
    vi.fn<(projectId: string) => Promise<ProjectPullRequestTarget>>(),
  fetchProjectSpaceContribution:
    vi.fn<(projectId: string, entryId: string) => Promise<SpaceContribution>>(),
  integrateProjectSpace:
    vi.fn<(projectId: string) => Promise<ProjectSpaceState>>(),
  integrateSpaceEntries:
    vi.fn<
      (projectId: string, entryIds: string[]) => Promise<ProjectSpaceState>
    >(),
  skipSpaceEntries:
    vi.fn<
      (projectId: string, entryIds: string[]) => Promise<ProjectSpaceState>
    >(),
  rebaseSpaceOntoMain: vi.fn<(projectId: string) => Promise<ProjectSpaceState>>(),
  fixSpaceRebaseConflict: vi.fn<(projectId: string) => Promise<{ slug: string }>>(),
  mergeSpaceIntoMain: vi.fn<
    (
      projectId: string,
      input?: { cleanup?: boolean }
    ) => Promise<{
      mergedCommitSha?: string;
      cleanupSummary?: string;
      sha?: string;
    }>
  >(),
  fixSpaceConflict:
    vi.fn<
      (
        projectId: string,
        entryId: string
      ) => Promise<{ entryId: string; slug: string }>
    >(),
  commitProjectChanges:
    vi.fn<
      (
        projectId: string,
        message: string
      ) => Promise<{ ok: boolean; error?: string }>
    >(),
}));

vi.mock("../../api/client", () => ({
  fetchProjectChanges: mocks.fetchProjectChanges,
  fetchProjectSpace: mocks.fetchProjectSpace,
  fetchProjectSpaceCommits: mocks.fetchProjectSpaceCommits,
  fetchProjectPullRequestTarget: mocks.fetchProjectPullRequestTarget,
  fetchProjectSpaceContribution: mocks.fetchProjectSpaceContribution,
  integrateProjectSpace: mocks.integrateProjectSpace,
  integrateSpaceEntries: mocks.integrateSpaceEntries,
  skipSpaceEntries: mocks.skipSpaceEntries,
  rebaseSpaceOntoMain: mocks.rebaseSpaceOntoMain,
  fixSpaceRebaseConflict: mocks.fixSpaceRebaseConflict,
  mergeSpaceIntoMain: mocks.mergeSpaceIntoMain,
  fixSpaceConflict: mocks.fixSpaceConflict,
  commitProjectChanges: mocks.commitProjectChanges,
}));

const baseChanges: ProjectChanges = {
  branch: "space/PRO-1",
  baseBranch: "main",
  source: { type: "space", path: "/tmp/space" },
  files: [{ path: "src/app.ts", status: "modified", staged: false }],
  diff: [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 0000000..1111111 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,2 +1,2 @@",
    "-old line",
    "+new line",
  ].join("\n"),
  stats: { filesChanged: 1, insertions: 1, deletions: 1 },
};

const baseSpace: ProjectSpaceState = {
  version: 1,
  projectId: "PRO-1",
  branch: "space/PRO-1",
  worktreePath: "/tmp/space",
  baseBranch: "main",
  integrationBlocked: false,
  queue: [
    {
      id: "alpha:1",
      workerSlug: "alpha",
      runMode: "worktree",
      worktreePath: "/tmp/alpha",
      startSha: "a",
      endSha: "b",
      shas: ["abc123"],
      status: "pending",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
  ],
  updatedAt: new Date().toISOString(),
};

async function flush(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("ChangesView", () => {
  beforeEach(() => {
    mocks.fetchProjectChanges.mockReset();
    mocks.fetchProjectSpace.mockReset();
    mocks.fetchProjectSpaceCommits.mockReset();
    mocks.fetchProjectPullRequestTarget.mockReset();
    mocks.fetchProjectSpaceContribution.mockReset();
    mocks.integrateProjectSpace.mockReset();
    mocks.integrateSpaceEntries.mockReset();
    mocks.skipSpaceEntries.mockReset();
    mocks.rebaseSpaceOntoMain.mockReset();
    mocks.fixSpaceRebaseConflict.mockReset();
    mocks.mergeSpaceIntoMain.mockReset();
    mocks.fixSpaceConflict.mockReset();
    mocks.commitProjectChanges.mockReset();

    mocks.fetchProjectChanges.mockResolvedValue(baseChanges);
    mocks.fetchProjectSpace.mockResolvedValue(baseSpace);
    mocks.fetchProjectSpaceCommits.mockResolvedValue([
      {
        sha: "abc1234",
        subject: "worker commit",
        author: "test",
        date: "2026-03-01T00:00:00.000Z",
      },
    ]);
    mocks.fetchProjectPullRequestTarget.mockResolvedValue({
      branch: "space/PRO-1",
      baseBranch: "main",
      compareUrl: "https://github.com/org/repo/compare/main...space%2FPRO-1",
    });
    mocks.fetchProjectSpaceContribution.mockResolvedValue({
      entry: baseSpace.queue[0]!,
      commits: [
        {
          sha: "abc123",
          subject: "worker commit",
          author: "test",
          date: "2026-03-01T00:00:00.000Z",
        },
      ],
      diff: "diff --git a/src/app.ts b/src/app.ts",
      conflictFiles: [],
    });
    mocks.integrateProjectSpace.mockResolvedValue(baseSpace);
    mocks.integrateSpaceEntries.mockResolvedValue(baseSpace);
    mocks.skipSpaceEntries.mockResolvedValue(baseSpace);
    mocks.rebaseSpaceOntoMain.mockResolvedValue(baseSpace);
    mocks.fixSpaceRebaseConflict.mockResolvedValue({
      slug: "space-rebase-reviewer",
    });
    mocks.mergeSpaceIntoMain.mockResolvedValue({
      mergedCommitSha: "abc1234",
      cleanupSummary: "Removed 2 worktrees and 2 branches",
    });
    mocks.fixSpaceConflict.mockResolvedValue({
      entryId: "alpha:1",
      slug: "fix-alpha",
    });
    mocks.commitProjectChanges.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders space queue and diff", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    expect(container.textContent).toContain("Space branch: space/PRO-1");
    expect(container.textContent).toContain("Space Commit Log");
    expect(container.textContent).toContain("src/app.ts");
    expect(container.textContent).toContain("+new line");

    dispose();
  });

  it("integrates pending queue", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const integrateBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Integrate Now")
    ) as HTMLButtonElement | undefined;
    expect(integrateBtn).toBeDefined();

    integrateBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(mocks.integrateProjectSpace).toHaveBeenCalledWith("PRO-1");

    dispose();
  });

  it("renders per-worker skip/integrate buttons", async () => {
    mocks.fetchProjectSpace.mockResolvedValue({
      ...baseSpace,
      queue: [
        ...baseSpace.queue,
        {
          ...baseSpace.queue[0]!,
          id: "alpha:2",
          status: "integrated",
        },
        {
          ...baseSpace.queue[0]!,
          id: "beta:1",
          workerSlug: "beta",
        },
      ],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const groups = Array.from(container.querySelectorAll(".worker-group"));
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.textContent).toContain("Skip");
      expect(group.textContent).toContain("Integrate");
    }

    dispose();
  });

  it("calls per-worker skip API with pending entry ids", async () => {
    mocks.fetchProjectSpace.mockResolvedValue({
      ...baseSpace,
      queue: [
        {
          ...baseSpace.queue[0]!,
          id: "alpha:1",
          workerSlug: "alpha",
          status: "pending",
        },
        {
          ...baseSpace.queue[0]!,
          id: "alpha:2",
          workerSlug: "alpha",
          status: "pending",
        },
        {
          ...baseSpace.queue[0]!,
          id: "alpha:3",
          workerSlug: "alpha",
          status: "integrated",
        },
        {
          ...baseSpace.queue[0]!,
          id: "beta:1",
          workerSlug: "beta",
          status: "pending",
        },
      ],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const alphaGroup = Array.from(
      container.querySelectorAll(".worker-group")
    ).find((group) => group.textContent?.includes("alpha"));
    expect(alphaGroup).toBeDefined();

    const skipButton = Array.from(alphaGroup!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Skip")
    ) as HTMLButtonElement | undefined;

    expect(skipButton).toBeDefined();
    skipButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(mocks.skipSpaceEntries).toHaveBeenCalledWith("PRO-1", [
      "alpha:1",
      "alpha:2",
    ]);

    dispose();
  });

  it("calls per-worker integrate API with pending entry ids", async () => {
    mocks.fetchProjectSpace.mockResolvedValue({
      ...baseSpace,
      queue: [
        {
          ...baseSpace.queue[0]!,
          id: "alpha:1",
          workerSlug: "alpha",
          status: "pending",
        },
        {
          ...baseSpace.queue[0]!,
          id: "alpha:2",
          workerSlug: "alpha",
          status: "pending",
        },
        {
          ...baseSpace.queue[0]!,
          id: "alpha:3",
          workerSlug: "alpha",
          status: "integrated",
        },
        {
          ...baseSpace.queue[0]!,
          id: "beta:1",
          workerSlug: "beta",
          status: "pending",
        },
      ],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const alphaGroup = Array.from(
      container.querySelectorAll(".worker-group")
    ).find((group) => group.textContent?.includes("alpha"));
    expect(alphaGroup).toBeDefined();

    const integrateButton = Array.from(
      alphaGroup!.querySelectorAll("button")
    ).find((btn) => btn.textContent?.includes("Integrate")) as
      | HTMLButtonElement
      | undefined;
    expect(integrateButton).toBeDefined();

    integrateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(mocks.integrateSpaceEntries).toHaveBeenCalledWith("PRO-1", [
      "alpha:1",
      "alpha:2",
    ]);

    dispose();
  });

  it("rebases space onto main", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const rebaseBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Rebase on main")
    ) as HTMLButtonElement | undefined;
    expect(rebaseBtn).toBeDefined();

    rebaseBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(mocks.rebaseSpaceOntoMain).toHaveBeenCalledWith("PRO-1");

    dispose();
  });

  it("loads contribution details for queue entry", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const entryRow = container.querySelector(
      ".entry-row"
    ) as HTMLElement | null;
    expect(entryRow).toBeDefined();

    entryRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(mocks.fetchProjectSpaceContribution).toHaveBeenCalledWith(
      "PRO-1",
      "alpha:1"
    );
    expect(container.textContent).toContain("worker commit");

    dispose();
  });

  it("shows rebase conflict UI and starts fixer", async () => {
    mocks.fetchProjectSpace.mockResolvedValue({
      ...baseSpace,
      rebaseConflict: {
        baseSha: "deadbeef",
        error: "Resolve content conflict in src/app.ts",
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    expect(container.textContent).toContain("Space rebase conflict (deadbeef)");

    const fixBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Fix rebase conflict")
    ) as HTMLButtonElement | undefined;
    expect(fixBtn).toBeDefined();

    fixBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(mocks.fixSpaceRebaseConflict).toHaveBeenCalledWith("PRO-1");
    expect(container.textContent).toContain(
      "Fixer agent spawned (space-rebase-reviewer)"
    );

    dispose();
  });

  it("shows merge-to-main controls only when queue is terminal", async () => {
    const pendingContainer = document.createElement("div");
    document.body.appendChild(pendingContainer);
    const pendingDispose = render(
      () => <ChangesView projectId="PRO-1" />,
      pendingContainer
    );
    await flush();
    expect(pendingContainer.textContent).not.toContain("Merge space into main");
    pendingDispose();

    mocks.fetchProjectSpace.mockResolvedValue({
      ...baseSpace,
      queue: [
        { ...baseSpace.queue[0]!, status: "integrated" },
        {
          ...baseSpace.queue[0]!,
          id: "alpha:2",
          status: "skipped",
          shas: [],
        },
      ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    expect(container.textContent).toContain("Merge space into main");
    expect(container.textContent).toContain("Clean up worktrees & branches");

    dispose();
  });

  it("merges space into main with cleanup toggle", async () => {
    mocks.fetchProjectSpace.mockResolvedValue({
      ...baseSpace,
      queue: [{ ...baseSpace.queue[0]!, status: "integrated" }],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const cleanupToggle = Array.from(container.querySelectorAll("input")).find(
      (input) =>
        input instanceof HTMLInputElement &&
        input.type === "checkbox" &&
        input.parentElement?.textContent?.includes(
          "Clean up worktrees & branches"
        )
    ) as HTMLInputElement | undefined;
    expect(cleanupToggle).toBeDefined();
    cleanupToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    const mergeBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Merge space into main")
    ) as HTMLButtonElement | undefined;
    expect(mergeBtn).toBeDefined();

    mergeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(mocks.mergeSpaceIntoMain).toHaveBeenCalledWith("PRO-1", {
      cleanup: false,
    });
    expect(container.textContent).toContain("Space merged into main");
    expect(container.textContent).toContain("abc1234");

    dispose();
  });

  it("commits changes and refreshes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const input = container.querySelector(".commit-input") as HTMLInputElement;
    const button = container.querySelector(".commit-btn") as HTMLButtonElement;

    input.value = "ship changes";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flush();

    expect(mocks.commitProjectChanges).toHaveBeenCalledWith(
      "PRO-1",
      "ship changes"
    );

    dispose();
  });
});
