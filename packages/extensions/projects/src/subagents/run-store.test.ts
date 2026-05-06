import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { InMemorySubagentRunStore } from "./run-store.js";

describe("SubagentRunStore in-memory adapter", () => {
  const projectDir = path.join("tmp", "PRO-1_example");

  it("lists summaries and filters archived runs", async () => {
    const store = new InMemorySubagentRunStore();
    store.seed(projectDir, "worker", {
      config: {
        cli: "codex",
        name: "Worker",
        projectId: "PRO-1",
        sliceId: "PRO-1-S01",
        runMode: "clone",
        archived: false,
      },
      state: {
        started_at: "2026-05-06T10:00:00.000Z",
        worktree_path: "/repo/worktree",
      },
      progress: { last_active: "2026-05-06T10:01:00.000Z" },
    });
    store.seed(projectDir, "old-worker", {
      config: { cli: "claude", archived: true },
    });

    const visible = await store.list(projectDir);
    expect(visible.map((item) => item.slug)).toEqual(["worker"]);
    expect(visible[0]).toMatchObject({
      cli: "codex",
      name: "Worker",
      projectId: "PRO-1",
      sliceId: "PRO-1-S01",
      runMode: "clone",
      worktreePath: "/repo/worktree",
      lastActive: "2026-05-06T10:01:00.000Z",
      archived: false,
    });

    const all = await store.list(projectDir, { includeArchived: true });
    expect(all.map((item) => item.slug)).toEqual(["worker", "old-worker"]);
  });

  it("updates state and derives terminal history status", async () => {
    const store = new InMemorySubagentRunStore();
    store.seed(projectDir, "worker", { config: { cli: "codex" } });

    await store.updateState(projectDir, "worker", {
      session_id: "thread-1",
      last_error: "",
    });
    await store.appendHistory(projectDir, "worker", [
      {
        type: "worker.finished",
        data: { outcome: "replied" },
      },
    ]);

    const detail = await store.read(projectDir, "worker");
    expect(detail?.state?.session_id).toBe("thread-1");
    expect(await store.deriveStatus(store.locate(projectDir, "worker"))).toBe(
      "replied"
    );
  });

  it("archives, unarchives, and deletes runs", async () => {
    const store = new InMemorySubagentRunStore();
    store.seed(projectDir, "worker", { config: { cli: "pi" } });

    await store.archive(projectDir, "worker");
    expect((await store.read(projectDir, "worker"))?.archived).toBe(true);
    expect(await store.list(projectDir)).toEqual([]);

    await store.unarchive(projectDir, "worker");
    expect((await store.read(projectDir, "worker"))?.archived).toBe(false);

    await store.delete(projectDir, "worker");
    expect(await store.read(projectDir, "worker")).toBeNull();
  });
});
