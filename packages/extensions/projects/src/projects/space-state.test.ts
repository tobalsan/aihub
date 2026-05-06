import { describe, expect, it } from "vitest";
import { parseSpaceFile } from "./space-state.js";

describe("space state", () => {
  it("normalizes space.json queue entries", () => {
    const parsed = parseSpaceFile(
      JSON.stringify({
        projectId: " PRO-1 ",
        branch: " space/PRO-1 ",
        worktreePath: " /tmp/space ",
        integrationBlocked: true,
        queue: [
          {
            id: "entry-1",
            workerSlug: " alpha ",
            runMode: "clone",
            worktreePath: " /tmp/worker ",
            shas: [" a ", "", 42, "b"],
            status: "unknown",
            createdAt: "2026-05-06T00:00:00.000Z",
          },
          { id: "", workerSlug: "bad", worktreePath: "/tmp/bad" },
        ],
      })
    );

    expect(parsed?.projectId).toBe("PRO-1");
    expect(parsed?.baseBranch).toBe("main");
    expect(parsed?.integrationBlocked).toBe(true);
    expect(parsed?.queue).toHaveLength(1);
    expect(parsed?.queue[0]).toMatchObject({
      id: "entry-1",
      workerSlug: "alpha",
      runMode: "clone",
      worktreePath: "/tmp/worker",
      shas: ["a", "b"],
      status: "pending",
    });
  });
});

