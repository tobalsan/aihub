// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ChangesView } from "./ChangesView";
import type { ProjectChanges, ProjectSpaceState } from "../../api/types";

const mocks = vi.hoisted(() => ({
  fetchProjectChanges: vi.fn<(projectId: string) => Promise<ProjectChanges>>(),
  fetchProjectSpace: vi.fn<(projectId: string) => Promise<ProjectSpaceState>>(),
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
  commitProjectChanges: mocks.commitProjectChanges,
}));

const baseChanges: ProjectChanges = {
  branch: "feature/changes",
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
  queue: [],
  updatedAt: new Date().toISOString(),
};

async function flush(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("ChangesView", () => {
  beforeEach(() => {
    mocks.fetchProjectChanges.mockReset();
    mocks.fetchProjectSpace.mockReset();
    mocks.commitProjectChanges.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders file list and diff", async () => {
    mocks.fetchProjectChanges.mockResolvedValue(baseChanges);
    mocks.fetchProjectSpace.mockResolvedValue(baseSpace);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    expect(container.textContent).toContain("Branch: feature/changes");
    expect(container.textContent).toContain("Space");
    expect(container.querySelectorAll(".file-row").length).toBe(1);
    expect(container.textContent).toContain("src/app.ts");
    expect(container.textContent).toContain("+new line");
    expect(container.textContent).toContain("-old line");

    dispose();
  });

  it("shows empty state", async () => {
    mocks.fetchProjectChanges.mockResolvedValue({
      ...baseChanges,
      files: [],
      diff: "",
      stats: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
    mocks.fetchProjectSpace.mockResolvedValue(baseSpace);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ChangesView projectId="PRO-1" />, container);

    await flush();

    expect(container.textContent).toContain("No uncommitted changes");

    dispose();
  });

  it("commits changes and refreshes", async () => {
    mocks.fetchProjectChanges
      .mockResolvedValueOnce(baseChanges)
      .mockResolvedValueOnce({
        ...baseChanges,
        files: [],
        diff: "",
        stats: { filesChanged: 0, insertions: 0, deletions: 0 },
      });
    mocks.fetchProjectSpace.mockResolvedValue(baseSpace);
    mocks.commitProjectChanges.mockResolvedValue({ ok: true });

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
    expect(container.textContent).toContain("No uncommitted changes");

    dispose();
  });
});
