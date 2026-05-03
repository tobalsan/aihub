import { describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import type { ProjectListItem } from "../projects/store.js";
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

function project(id: string, status = "todo"): ProjectListItem {
  return {
    id,
    title: `${id} title`,
    path: id,
    absolutePath: `/tmp/projects/${id}`,
    repoValid: true,
    frontmatter: { status, repo: "/tmp/repo" },
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

// Default updateProject mock - record calls + always succeed. Tests that
// care about lock behavior pass their own mock to override.
function makeUpdateProjectMock(): {
  fn: (typeof import("../projects/store.js"))["updateProject"];
  calls: Array<{ id: string; status?: string }>;
} {
  const calls: Array<{ id: string; status?: string }> = [];
  const fn = (async (_cfg, id, input) => {
    calls.push({ id, status: input.status });
    return {
      ok: true,
      data: {
        id,
        title: `${id} title`,
        path: id,
        absolutePath: `/tmp/projects/${id}`,
        repoValid: true,
        frontmatter: { id, status: input.status ?? "todo" },
      },
    };
  }) as (typeof import("../projects/store.js"))["updateProject"];
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
        "/tmp/wt/s01"
      )
    ).toBe(true);
    expect(
      isActiveOrchestratorRun(
        run("running", "orchestrator", { worktreePath: "/tmp/wt/s02" }),
        "PRO-1-S01",
        "/tmp/wt/s01"
      )
    ).toBe(false);
  });
  it("dispatches Workers for eligible todo projects with orchestrator source", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const listSubagents = vi.fn(async () => ({
      ok: true as const,
      data: { items: [] },
    }));

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2"), project("PRO-3")],
      }),
      listSubagents,
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateProject: makeUpdateProjectMock().fn,
      now: () => new Date("2026-05-03T00:00:00.000Z"),
      log: () => {},
    });

    expect(result.availableSlots).toBe(2);
    expect(result.eligible).toBe(3);
    expect(spawned).toHaveLength(2);
    expect(spawned.map((input) => input.projectId)).toEqual(["PRO-1", "PRO-2"]);
    expect(spawned.every((input) => input.source === "orchestrator")).toBe(
      true
    );
    expect(spawned.every((input) => input.cli === "codex")).toBe(true);
    expect(spawned.every((input) => input.mode === "clone")).toBe(true);
    // Prompt embeds the actual aihub invocation (resolveAihubCli) for this
    // gateway, so the worker can run it directly without env-var indirection.
    // In tests, AIHUB_DEV is unset so it resolves to bare `aihub`.
    expect(spawned[0]?.prompt).toContain("`aihub projects move PRO-1 review`");
    expect(spawned[0]?.prompt).not.toContain("$AIHUB_CLI");
  });

  it("counts only running orchestrator runs against status slots", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2"), project("PRO-3")],
      }),
      listSubagents: async (_config, projectId) => {
        const items =
          projectId === "PRO-1"
            ? [run("running", "orchestrator")]
            : projectId === "PRO-2"
              ? [run("running", "manual")]
              : [];
        return { ok: true, data: { items } };
      },
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateProject: makeUpdateProjectMock().fn,
      log: () => {},
    });

    expect(result.running).toBe(1);
    expect(result.availableSlots).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.projectId).toBe("PRO-2");
  });

  it("ignores non-todo projects and skips todo projects with active orchestrator runs", async () => {
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
          data: [
            project("PRO-1"),
            project("PRO-2", "review"),
            project("PRO-3"),
          ],
        }),
        listSubagents: async (_config, projectId) => {
          const items =
            projectId === "PRO-1" ? [run("running", "orchestrator")] : [];
          return { ok: true, data: { items } };
        },
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateProject: makeUpdateProjectMock().fn,
        log: () => {},
      }
    );

    expect(result.running).toBe(1);
    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.projectId).toBe("PRO-3");
  });

  it("records an attempt + cleans the orphan dir when spawnSubagent throws", async () => {
    const removed: string[] = [];
    const recorded: Array<{ projectId: string; atMs: number }> = [];
    const tracker = {
      record: (projectId: string, atMs: number) => {
        recorded.push({ projectId, atMs });
      },
      isCoolingDown: () => false,
      clear: () => {},
    };

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1")],
      }),
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async () => {
        throw new Error("git worktree add failed");
      },
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
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.projectId).toBe("PRO-1");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(
      /\/tmp\/projects\/PRO-1\/sessions\/orchestrator-pro-1-/
    );
  });

  it("keys cooldown by sliceId when present", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const tracker = {
      record: () => {},
      isCoolingDown: (sliceId: string) => sliceId === "PRO-1-S01",
      clear: () => {},
    };

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [
          { ...project("PRO-1"), sliceId: "PRO-1-S01" } as ProjectListItem,
          { ...project("PRO-2"), sliceId: "PRO-1-S02" } as ProjectListItem,
        ],
      }),
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateProject: makeUpdateProjectMock().fn,
      attempts: tracker,
      log: () => {},
    });

    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.projectId).toBe("PRO-2");
    expect(spawned[0]?.sliceId).toBe("PRO-1-S02");
  });

  it("skips projects in the failure cooldown window", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const tracker = {
      record: () => {},
      isCoolingDown: (projectId: string) => projectId === "PRO-1",
      clear: () => {},
    };

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2")],
      }),
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateProject: makeUpdateProjectMock().fn,
      attempts: tracker,
      log: () => {},
    });

    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.projectId).toBe("PRO-2");
  });

  it("locks spawned projects by moving them to in_progress", async () => {
    const updates = makeUpdateProjectMock();

    await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1"), project("PRO-2")],
      }),
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => ({
        ok: true,
        data: { slug: input.slug },
      }),
      updateProject: updates.fn,
      log: () => {},
    });

    expect(updates.calls).toEqual([
      { id: "PRO-1", status: "in_progress" },
      { id: "PRO-2", status: "in_progress" },
    ]);
  });

  it("dispatches Reviewers for eligible review projects without a status lock", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const updates = makeUpdateProjectMock();

    const result = await dispatchOrchestratorTick(
      config,
      {
        ...orchestratorConfig,
        statuses: { review: { profile: "Reviewer", max_concurrent: 2 } },
      },
      {
        listProjects: async () => ({
          ok: true,
          data: [project("PRO-1", "review")],
        }),
        listSubagents: async () => ({ ok: true, data: { items: [] } }),
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateProject: updates.fn,
        now: () => new Date("2026-05-03T00:00:00.000Z"),
        log: () => {},
      }
    );

    expect(result.availableSlots).toBe(2);
    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.projectId).toBe("PRO-1");
    expect(spawned[0]?.name).toBe("Reviewer");
    expect(spawned[0]?.mode).toBe("none");
    expect(spawned[0]?.source).toBe("orchestrator");
    expect(spawned[0]?.sliceId).toBeUndefined();
    expect(spawned[0]?.prompt).toContain(
      "`aihub projects move PRO-1 ready_to_merge`"
    );
    expect(updates.calls).toEqual([]);
  });

  it("accounts todo and review slots independently", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const updates = makeUpdateProjectMock();

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
          data: [
            project("PRO-1"),
            project("PRO-2"),
            project("PRO-3", "review"),
          ],
        }),
        listSubagents: async () => ({ ok: true, data: { items: [] } }),
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        updateProject: updates.fn,
        log: () => {},
      }
    );

    expect(result.availableSlots).toBe(2);
    expect(result.eligible).toBe(3);
    expect(spawned.map((input) => input.projectId)).toEqual(["PRO-1", "PRO-3"]);
    expect(spawned.map((input) => input.name)).toEqual(["Worker", "Reviewer"]);
    expect(updates.calls).toEqual([{ id: "PRO-1", status: "in_progress" }]);
  });

  it("does not dispatch reviewers when review is not configured", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(config, orchestratorConfig, {
      listProjects: async () => ({
        ok: true,
        data: [project("PRO-1", "review")],
      }),
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateProject: makeUpdateProjectMock().fn,
      log: () => {},
    });

    expect(result.eligible).toBe(0);
    expect(spawned).toEqual([]);
  });

  it("includes the most recent worker workspace in reviewer prompts", async () => {
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
          data: [project("PRO-1", "review")],
        }),
        listSubagents: async () => ({
          ok: true,
          data: {
            items: [
              run("idle", "orchestrator", {
                name: "Worker",
                cli: "codex",
                worktreePath: "/tmp/workspaces/old",
                startedAt: "2026-05-03T00:00:00.000Z",
              }),
              run("idle", "orchestrator", {
                name: "Worker",
                cli: "codex",
                worktreePath: "/tmp/workspaces/new",
                startedAt: "2026-05-03T01:00:00.000Z",
              }),
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
        updateProject: makeUpdateProjectMock().fn,
        log: () => {},
      }
    );

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.prompt).toContain("Worker (codex): /tmp/workspaces/new");
    expect(spawned[0]?.prompt).not.toContain("/tmp/workspaces/old");
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
      listSubagents: async () => ({ ok: true, data: { items: [] } }),
      spawnSubagent: async (_config, input) => {
        spawned.push(input);
        return { ok: true, data: { slug: input.slug } };
      },
      updateProject: async () => ({
        ok: false,
        error: "disk full",
      }),
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
});
