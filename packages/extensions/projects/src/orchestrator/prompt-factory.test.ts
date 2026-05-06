import { describe, expect, it } from "vitest";
import { OrchestratorPromptFactory } from "./prompt-factory.js";

const factory = new OrchestratorPromptFactory("aihub-test");

describe("OrchestratorPromptFactory", () => {
  it("builds Worker prompts with slice docs and review handoff", () => {
    const prompt = factory.buildWorkerPrompt({
      sliceId: "PRO-1-S01",
      sliceTitle: "Add validation",
      projectDirPath: "/tmp/projects/PRO-1",
      sliceDirPath: "/tmp/projects/PRO-1/slices/PRO-1-S01",
    });

    expect(prompt).toContain("## Working on Slice: PRO-1-S01");
    expect(prompt).toContain("/tmp/projects/PRO-1/slices/PRO-1-S01/SPECS.md");
    expect(prompt).toContain("always pass `--author Worker`");
    expect(prompt).toContain("aihub-test slices move PRO-1-S01 review");
  });

  it("builds Reviewer prompts with worker workspace context", () => {
    const prompt = factory.buildReviewerPrompt({
      sliceId: "PRO-1-S01",
      sliceTitle: "Add validation",
      projectDirPath: "/tmp/projects/PRO-1",
      sliceDirPath: "/tmp/projects/PRO-1/slices/PRO-1-S01",
      workerWorkspaces: [
        { name: "Worker", cli: "codex", path: "/tmp/worktree" },
      ],
    });

    expect(prompt).toContain("- Worker (codex): /tmp/worktree");
    expect(prompt).toContain("always pass `--author Reviewer`");
    expect(prompt).toContain("aihub-test slices move PRO-1-S01 ready_to_merge");
    expect(prompt).toContain("aihub-test slices move PRO-1-S01 todo");
  });

  it("builds Merger prompts with integration and worker branches", () => {
    const prompt = factory.buildMergerPrompt({
      sliceId: "PRO-1-S01",
      sliceTitle: "Add validation",
      projectDirPath: "/tmp/projects/PRO-1",
      sliceDirPath: "/tmp/projects/PRO-1/slices/PRO-1-S01",
      baseBranch: "PRO-1/integration",
      workerBranch: "PRO-1/pro-1-s01-worker",
    });

    expect(prompt).toContain("Integration branch: PRO-1/integration");
    expect(prompt).toContain("Slice branch: PRO-1/pro-1-s01-worker");
    expect(prompt).toContain("always pass `--author Merger`");
    expect(prompt).toContain("aihub-test slices move PRO-1-S01 done");
  });
});
