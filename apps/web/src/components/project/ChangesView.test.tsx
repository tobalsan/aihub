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
    vi.fn<(projectId: string) => Promise<Array<{ sha: string; subject: string; author: string; date: string }>>>(),
  fetchProjectPullRequestTarget:
    vi.fn<(projectId: string) => Promise<ProjectPullRequestTarget>>(),
  fetchProjectSpaceContribution:
    vi.fn<(projectId: string, entryId: string) => Promise<SpaceContribution>>(),
  integrateProjectSpace: vi.fn<(projectId: string) => Promise<ProjectSpaceState>>(),
  spawnSpaceConflictFixer:
    vi.fn<(projectId: string, entryId: string) => Promise<{ entryId: string; slug: string }>>(),
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
  spawnSpaceConflictFixer: mocks.spawnSpaceConflictFixer,
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
    mocks.spawnSpaceConflictFixer.mockReset();
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
    mocks.spawnSpaceConflictFixer.mockResolvedValue({
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

    const integrateBtn = Array.from(
      container.querySelectorAll("button")
    ).find((btn) => btn.textContent?.includes("Integrate Now")) as
      | HTMLButtonElement
      | undefined;
    expect(integrateBtn).toBeDefined();

    integrateBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(mocks.integrateProjectSpace).toHaveBeenCalledWith("PRO-1");

    dispose();
  });

  it("loads contribution details for queue entry", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    const detailsBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Details"
    ) as HTMLButtonElement | undefined;
    expect(detailsBtn).toBeDefined();

    detailsBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(mocks.fetchProjectSpaceContribution).toHaveBeenCalledWith(
      "PRO-1",
      "alpha:1"
    );
    expect(container.textContent).toContain("worker commit");

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
