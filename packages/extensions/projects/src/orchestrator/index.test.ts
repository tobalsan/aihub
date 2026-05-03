import { describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import type { ProjectListItem } from "../projects/store.js";
import type { SliceRecord } from "../projects/slices.js";
import type { SubagentListItem } from "../subagents/index.js";
import type { SpawnSubagentInput } from "../subagents/runner.js";
import {
  dispatchOrchestratorTick,
  isActiveOrchestratorRun,
} from "./dispatcher.js";
import type { OrchestratorConfig } from "./config.js";

const config = {
  agents: [],
  extensions: {
    subagents: {
      profiles: [
        { name: "Worker", cli: "codex", runMode: "clone", type: "worker" },
        { name: "Reviewer", cli: "codex", runMode: "none", type: "reviewer" },
      ],
    },
    projects: {},
  },
} as GatewayConfig;

const orchestratorConfig: OrchestratorConfig = {
  enabled: true,
  poll_interval_ms: 30_000,
  failure_cooldown_ms: 60_000,
  statuses: {
    todo: { profile: "Worker", max_concurrent: 2 },
  },
};

/** Create a project in `active` status (the project gate for slice dispatch). */
function project(id: string, status = "active"): ProjectListItem {
  return {
    id,
    title: `${id} title`,
    path: id,
    absolutePath: `/tmp/projects/${id}`,
    repoValid: true,
    frontmatter: { status, repo: "/tmp/repo" },
  };
}

/** Create a minimal SliceRecord with given id and status. */
function slice(
  sliceId: string,
  projectId: string,
  status: SliceRecord["frontmatter"]["status"] = "todo"
): SliceRecord {
  return {
    id: sliceId,
    projectId,
    dirPath: `/tmp/projects/${projectId}/slices/${sliceId}`,
    frontmatter: {
      id: sliceId,
      project_id: projectId,
      title: `${sliceId} title`,
      status,
      hill_position: "figuring",
      created_at: "2026-05-03T00:00:00Z",
      updated_at: "2026-05-03T00:00:00Z",
    },
    docs: {
      readme: "## Must\n\n## Nice\n",
      specs: "",
      tasks: "",
      validation: "",
      thread: "",
    },
  };
}

function run(
  status: SubagentListItem["status"],
  source: SubagentListItem["source"],
  extra: Partial<SubagentListItem> = {}
): SubagentListItem {
  return {
    slug: `${source}-${status}`,
    status,
    source,
    ...extra,
  };
}

/** Default updateSlice mock — records calls + returns a slice record. */
function makeUpdateSliceMock(): {
  fn: typeof import("../projects/slices.js")["updateSlice"];
  calls: Array<{ sliceId: string; status?: string }>;
} {
  const calls: Array<{ sliceId: string; status?: string }> = [];
  const fn = (async (_projectDir, sliceId, input) => {
    calls.push({ sliceId, status: input.status });
    return slice(sliceId, sliceId.split("-S")[0] ?? sliceId);
  }) as typeof import("../projects/slices.js")["updateSlice"];
  return { fn, calls };
}

describe("orchestrator dispatcher", () => {
  it("matches active orchestrator run by sliceId", () => {
    expect(
      isActiveOrchestratorRun(
        run("running", "orchestrator", { sliceId: "PRO-1-S01" }),
        "PRO-1-S01"
      )
    ).toBe(true);
    expect(
      isActiveOrchestratorRun(
        run("running", "orchestrator", { sliceId: "PRO-1-S02" }),
        "PRO-1-S01"
      )
    ).toBe(false);
  });

  it("falls back to cwd for legacy run without sliceId", () => {
    expect(
      isActiveOrchestratorRun(
        run("running", "orchestrator", { worktreePath: "/tmp/wt/s01" }),
        "PRO-1-S01",
        ["/tmp/wt/s01"]
      )
    ).toBe(true);
    expect(
      isActiveOrchestratorRun(
        run("running", "orchestrator", { worktreePath: "/tmp/wt/s01/agent" }),
        "PRO-1-S01",
        ["/tmp/wt/s01"]
      )
    ).toBe(true);
    expect(
      isActiveOrchestratorRun(
        run("running", "orchestrator", { worktreePath: "/tmp/wt/s02" }),
        "PRO-1-S01",
        ["/tmp/wt/s01"]
      )
    ).toBe(false);
  });

  it("dispatches Workers for todo slices under active projects", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const updates = makeUpdateSliceMock();

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2"), project("PRO-3")],
      }),
      // PRO-1 has 2 slices in todo, PRO-2 has 1, PRO-3 has 1
      listSlices: async (projectDir) => {
        if (projectDir.includes("PRO-1")) {
          return [
            slice("PRO-1-S01", "PRO-1"),
            slice("PRO-1-S02", "PRO-1"),
          ];
        }
        if (projectDir.includes("PRO-2")) {
          return [slice("PRO-2-S01", "PRO-2")];
        }
        return [slice("PRO-3-S01", "PRO-3")];
      },
      listSubagents: async () => ({ ok: true as const, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: updates.fn,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
      log: () => {},
    });

    // max_concurrent = 2 so only 2 of the 4 eligible slices are dispatched
    expect(result.availableSlots).toBe(2);
    expect(result.eligible).toBe(4);
    expect(spawned).toHaveLength(2);
    // First two slices across projects (PRO-1-S01, PRO-1-S02)
    expect(spawned.every((input) => input.source === "orchestrator")).toBe(true);
    expect(spawned.every((input) => input.cli === "codex")).toBe(true);
    expect(spawned.every((input) => input.mode === "clone")).toBe(true);
    // sliceId is set on each spawn
    expect(spawned.map((s) => s.sliceId)).toEqual(["PRO-1-S01", "PRO-1-S02"]);
    // Prompt uses `aihub slices move` (not `projects move`)
    expect(spawned[0]?.prompt).toContain("`aihub slices move PRO-1-S01 review`");
    expect(spawned[0]?.prompt).not.toContain("projects move");
    // Worker lock: slices moved to in_progress
    expect(updates.calls.map((c) => c.sliceId)).toEqual([
      "PRO-1-S01",
      "PRO-1-S02",
    ]);
    expect(updates.calls.every((c) => c.status === "in_progress")).toBe(true);
  });

  it("does NOT dispatch slices under shaping projects", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [
          project("PRO-1", "shaping"), // shaping → not dispatched
          project("PRO-2", "active"),  // active → dispatched
        ],
      }),
      listSlices: async (projectDir) => {
        if (projectDir.includes("PRO-1")) return [slice("PRO-1-S01", "PRO-1")];
        return [slice("PRO-2-S01", "PRO-2")];
      },
      listSubagents: async () => ({ ok: true as const, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      log: () => {},
    });

    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sliceId).toBe("PRO-2-S01");
    expect(spawned[0]?.projectId).toBe("PRO-2");
  });

  it("counts only running orchestrator runs against status slots", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2"), project("PRO-3")],
      }),
      listSlices: async (projectDir) => {
        if (projectDir.includes("PRO-1")) return [slice("PRO-1-S01", "PRO-1")];
        if (projectDir.includes("PRO-2")) return [slice("PRO-2-S01", "PRO-2")];
        return [slice("PRO-3-S01", "PRO-3")];
      },
      listSubagents: async (_config, projectId) => {
        const items =
          projectId === "PRO-1"
            ? [run("running", "orchestrator", { sliceId: "PRO-1-S01" })]
            : projectId === "PRO-2"
              ? [run("running", "manual", { sliceId: "PRO-2-S01" })]
              : [];
        return { ok: true, data: { items } };
      },
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      log: () => {},
    });

    // PRO-1-S01 has active orchestrator run (1 running)
    // PRO-2-S01 has manual run (not counted against orchestrator slots)
    expect(result.running).toBe(1);
    expect(result.availableSlots).toBe(1);
    // PRO-1-S01 skipped (active run), PRO-2-S01 + PRO-3-S01 eligible (2), 1 slot
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sliceId).toBe("PRO-2-S01");
  });

  it("ignores non-todo slices and skips todo slices with active orchestrator runs", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(
      config,
      {
        ...orchestratorConfig,
        statuses: { todo: { profile: "Worker", max_concurrent: 5 } },
      },
      {
        listProjects: async () => ({
          ok: true,
          data: [project("PRO-1"), project("PRO-2"), project("PRO-3")],
        }),
        listSlices: async (projectDir) => {
          if (projectDir.includes("PRO-1")) {
            return [slice("PRO-1-S01", "PRO-1", "todo")];
          }
          if (projectDir.includes("PRO-2")) {
            // PRO-2 has a review slice (not todo, ignored for Worker dispatch)
            return [slice("PRO-2-S01", "PRO-2", "review")];
          }
          return [slice("PRO-3-S01", "PRO-3", "todo")];
        },
        listSubagents: async (_config, projectId) => {
          const items =
            projectId === "PRO-1"
              ? [run("running", "orchestrator", { sliceId: "PRO-1-S01" })]
              : [];
          return { ok: true, data: { items } };
        },
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateSlice: makeUpdateSliceMock().fn,
        log: () => {},
      }
    );

    expect(result.running).toBe(1);
    expect(result.eligible).toBe(1); // PRO-3-S01 is the only eligible todo slice
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sliceId).toBe("PRO-3-S01");
  });

  it("records an attempt + cleans the orphan dir when spawnSubagent throws", async () => {
    const removed: string[] = [];
    const recorded: Array<{ sliceId: string; atMs: number }> = [];
    const tracker = {
      record: (sliceId: string, atMs: number) => {
        recorded.push({ sliceId, atMs });
      },
      isCoolingDown: () => false,
      clear: () => {},
    };

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSlices: async () => [slice("PRO-1-S01", "PRO-1")],
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async () => {
        throw new Error("git worktree add failed");
      },
      updateSlice: makeUpdateSliceMock().fn,
      attempts: tracker,
      removeOrphanDir: async (dirPath: string) => {
        removed.push(dirPath);
      },
      now: () => new Date("2026-05-03T17:00:00.000Z"),
      log: () => {},
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.action).toBe("skipped");
    expect(result.decisions[0]?.reason).toBe("git worktree add failed");
    expect(result.decisions[0]?.sliceId).toBe("PRO-1-S01");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sliceId).toBe("PRO-1-S01");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/\/tmp\/projects\/PRO-1\/sessions\/pro-1-s01-/);
  });

  it("sibling slices are independent — active run on S01 does not block S02", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSlices: async () => [
        slice("PRO-1-S01", "PRO-1"),
        slice("PRO-1-S02", "PRO-1"),
      ],
      listSubagents: async () => ({
        ok: true,
        data: {
          items: [
            run("running", "orchestrator", { sliceId: "PRO-1-S01" }),
          ],
        },
      }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      log: () => {},
    });

    expect(result.running).toBe(1);
    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sliceId).toBe("PRO-1-S02");
  });

  it("keys cooldown by sliceId", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const tracker = {
      record: () => {},
      // PRO-1-S01 is cooling down; PRO-1-S02 is not
      isCoolingDown: (sliceId: string) => sliceId === "PRO-1-S01",
      clear: () => {},
    };

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSlices: async () => [
        slice("PRO-1-S01", "PRO-1"),
        slice("PRO-1-S02", "PRO-1"),
      ],
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      attempts: tracker,
      log: () => {},
    });

    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sliceId).toBe("PRO-1-S02");
    expect(spawned[0]?.projectId).toBe("PRO-1");
  });

  it("matches legacy active run by repo cwd fallback", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [
          {
            ...project("PRO-1"),
            frontmatter: { status: "active", repo: "/tmp/repo" },
          },
        ],
      }),
      listSlices: async () => [slice("PRO-1-S01", "PRO-1")],
      listSubagents: async () => ({
        ok: true,
        data: {
          items: [
            // Legacy run: has worktreePath but no sliceId
            run("running", "orchestrator", {
              worktreePath: "/tmp/repo",
            }),
          ],
        },
      }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      log: () => {},
    });

    expect(result.running).toBe(1);
    expect(result.eligible).toBe(0);
    expect(spawned).toHaveLength(0);
  });

  it("skips slices in the failure cooldown window", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const tracker = {
      record: () => {},
      isCoolingDown: (sliceId: string) => sliceId === "PRO-1-S01",
      clear: () => {},
    };

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2")],
      }),
      listSlices: async (projectDir) => {
        if (projectDir.includes("PRO-1")) return [slice("PRO-1-S01", "PRO-1")];
        return [slice("PRO-2-S01", "PRO-2")];
      },
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      attempts: tracker,
      log: () => {},
    });

    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sliceId).toBe("PRO-2-S01");
  });

  it("locks spawned Worker slices by moving them to in_progress (project status unchanged)", async () => {
    const updates = makeUpdateSliceMock();

    await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2")],
      }),
      listSlices: async (projectDir) => {
        if (projectDir.includes("PRO-1")) return [slice("PRO-1-S01", "PRO-1")];
        return [slice("PRO-2-S01", "PRO-2")];
      },
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => ({
        ok: true,
        data: { slug: input.slug },
      }),
      updateSlice: updates.fn,
      log: () => {},
    });

    expect(updates.calls).toEqual([
      { sliceId: "PRO-1-S01", status: "in_progress" },
      { sliceId: "PRO-2-S01", status: "in_progress" },
    ]);
  });

  it("dispatches Reviewers for slices in review status under active projects", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const updates = makeUpdateSliceMock();

    const result = await dispatchOrchestratorTick(
      config,
      {
        ...orchestratorConfig,
        statuses: { review: { profile: "Reviewer", max_concurrent: 2 } },
      },
      {
        listProjects: async () => ({
          ok: true,
          data: [project("PRO-1")],
        }),
        listSlices: async () => [
          slice("PRO-1-S01", "PRO-1", "review"),
        ],
        listSubagents: async () => ({ ok: true, data: { items: [] } }),
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateSlice: updates.fn,
        now: () => new Date("2026-05-03T00:00:00.000Z"),
        log: () => {},
      }
    );

    expect(result.availableSlots).toBe(2);
    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sliceId).toBe("PRO-1-S01");
    expect(spawned[0]?.projectId).toBe("PRO-1");
    expect(spawned[0]?.name).toBe("Reviewer");
    expect(spawned[0]?.mode).toBe("none");
    expect(spawned[0]?.source).toBe("orchestrator");
    // Reviewer uses `slices move` for both pass and fail paths
    expect(spawned[0]?.prompt).toContain(
      "`aihub slices move PRO-1-S01 ready_to_merge`"
    );
    // Reviewer does NOT lock the slice status
    expect(updates.calls).toEqual([]);
  });

  it("accounts todo and review slots independently", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const updates = makeUpdateSliceMock();

    const result = await dispatchOrchestratorTick(
      config,
      {
        ...orchestratorConfig,
        statuses: {
          todo: { profile: "Worker", max_concurrent: 1 },
          review: { profile: "Reviewer", max_concurrent: 1 },
        },
      },
      {
        listProjects: async () => ({
          ok: true,
          data: [project("PRO-1"), project("PRO-2")],
        }),
        listSlices: async (projectDir) => {
          if (projectDir.includes("PRO-1")) {
            return [
              slice("PRO-1-S01", "PRO-1", "todo"),
              slice("PRO-1-S02", "PRO-1", "review"),
            ];
          }
          return [slice("PRO-2-S01", "PRO-2", "todo")];
        },
        listSubagents: async () => ({ ok: true, data: { items: [] } }),
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateSlice: updates.fn,
        log: () => {},
      }
    );

    // 1 slot for todo (2 eligible: PRO-1-S01, PRO-2-S01) → 1 spawned
    // 1 slot for review (1 eligible: PRO-1-S02) → 1 spawned
    expect(result.availableSlots).toBe(2);
    expect(result.eligible).toBe(3);
    expect(spawned).toHaveLength(2);
    const workerSpawns = spawned.filter((s) => s.name === "Worker");
    const reviewerSpawns = spawned.filter((s) => s.name === "Reviewer");
    expect(workerSpawns).toHaveLength(1);
    expect(reviewerSpawns).toHaveLength(1);
    // Worker lock applied only for todo slice
    expect(updates.calls).toHaveLength(1);
    expect(updates.calls[0]?.status).toBe("in_progress");
  });

  it("does not dispatch when configured status has no eligible slices", async () => {
    const spawned: SpawnSubagentInput[] = [];

    // Only `review` configured but all slices are in `todo`
    const result = await dispatchOrchestratorTick(
      config,
      {
        ...orchestratorConfig,
        statuses: { review: { profile: "Reviewer", max_concurrent: 1 } },
      },
      {
        listProjects: async () => ({
          ok: true,
          data: [project("PRO-1")],
        }),
        listSlices: async () => [slice("PRO-1-S01", "PRO-1", "todo")],
        listSubagents: async () => ({ ok: true, data: { items: [] } }),
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateSlice: makeUpdateSliceMock().fn,
        log: () => {},
      }
    );

    expect(result.eligible).toBe(0);
    expect(spawned).toEqual([]);
  });

  it("includes the most recent worker workspace in reviewer prompts (filtered by sliceId)", async () => {
    const spawned: SpawnSubagentInput[] = [];

    await dispatchOrchestratorTick(
      config,
      {
        ...orchestratorConfig,
        statuses: { review: { profile: "Reviewer", max_concurrent: 1 } },
      },
      {
        listProjects: async () => ({
          ok: true,
          data: [project("PRO-1")],
        }),
        listSlices: async () => [slice("PRO-1-S01", "PRO-1", "review")],
        listSubagents: async () => ({
          ok: true,
          data: {
            items: [
              run("idle", "orchestrator", {
                name: "Worker",
                cli: "codex",
                worktreePath: "/tmp/workspaces/old",
                sliceId: "PRO-1-S01",
                startedAt: "2026-05-03T00:00:00.000Z",
              }),
              run("idle", "orchestrator", {
                name: "Worker",
                cli: "codex",
                worktreePath: "/tmp/workspaces/new",
                sliceId: "PRO-1-S01",
                startedAt: "2026-05-03T01:00:00.000Z",
              }),
              // Different slice — should NOT appear in PRO-1-S01 reviewer prompt
              run("idle", "orchestrator", {
                name: "Worker",
                cli: "codex",
                worktreePath: "/tmp/workspaces/other-slice",
                sliceId: "PRO-1-S02",
                startedAt: "2026-05-03T02:00:00.000Z",
              }),
              // Manual run — not an orchestrator worker run
              run("idle", "manual", {
                name: "Worker",
                cli: "codex",
                worktreePath: "/tmp/workspaces/manual",
                startedAt: "2026-05-03T02:00:00.000Z",
              }),
            ],
          },
        }),
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateSlice: makeUpdateSliceMock().fn,
        log: () => {},
      }
    );

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.prompt).toContain("Worker (codex): /tmp/workspaces/new");
    expect(spawned[0]?.prompt).not.toContain("/tmp/workspaces/old");
    expect(spawned[0]?.prompt).not.toContain("/tmp/workspaces/other-slice");
    expect(spawned[0]?.prompt).not.toContain("/tmp/workspaces/manual");
  });

  it("logs lock_failed but does not unwind a successful spawn", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const logs: string[] = [];

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSlices: async () => [slice("PRO-1-S01", "PRO-1")],
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: async () => {
        throw new Error("disk full");
      },
      log: (msg) => logs.push(msg),
    });

    expect(spawned).toHaveLength(1);
    expect(result.decisions[0]?.action).toBe("spawned");
    expect(
      logs.some(
        (m) =>
          m.includes("action=lock_failed") && m.includes("reason=disk full")
      )
    ).toBe(true);
  });

  it("Worker prompt includes stay-in-slice clause and slice-specific file links", async () => {
    const spawned: SpawnSubagentInput[] = [];

    await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSlices: async () => [slice("PRO-1-S01", "PRO-1")],
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      log: () => {},
    });

    expect(spawned).toHaveLength(1);
    const prompt = spawned[0]?.prompt ?? "";
    // Stay-in-slice clause
    expect(prompt).toContain("Stay in Your Slice");
    // Slice doc links
    expect(prompt).toContain(
      `/tmp/projects/PRO-1/slices/PRO-1-S01/SPECS.md`
    );
    expect(prompt).toContain(
      `/tmp/projects/PRO-1/slices/PRO-1-S01/TASKS.md`
    );
    expect(prompt).toContain(
      `/tmp/projects/PRO-1/slices/PRO-1-S01/VALIDATION.md`
    );
    // Project context (pitch + scope map)
    expect(prompt).toContain(`/tmp/projects/PRO-1/README.md`);
    expect(prompt).toContain(`/tmp/projects/PRO-1/SCOPE_MAP.md`);
  });

  it("Worker run gets projectId + sliceId in spawn input", async () => {
    const spawned: SpawnSubagentInput[] = [];

    await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSlices: async () => [slice("PRO-1-S01", "PRO-1")],
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      log: () => {},
    });

    expect(spawned[0]?.projectId).toBe("PRO-1");
    expect(spawned[0]?.sliceId).toBe("PRO-1-S01");
  });

  it("worktree slug encodes sliceId for §5.8 path layout", async () => {
    const spawned: SpawnSubagentInput[] = [];

    await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSlices: async () => [slice("PRO-1-S01", "PRO-1")],
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateSlice: makeUpdateSliceMock().fn,
      now: () => new Date("2026-05-03T17:00:00.000Z"),
      log: () => {},
    });

    // Slug starts with lowercase sliceId prefix
    expect(spawned[0]?.slug).toMatch(/^pro-1-s01-/);
  });
});
