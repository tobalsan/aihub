import { describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import type { ProjectListItem } from "../projects/store.js";
import type { SubagentListItem } from "../subagents/index.js";
import type { SpawnSubagentInput } from "../subagents/runner.js";
import { dispatchOrchestratorTick } from "./dispatcher.js";
import type { OrchestratorConfig } from "./config.js";

const config = {
  agents: [],
  extensions: {
    subagents: {
      profiles: [{ name: "Worker", cli: "codex", runMode: "clone" }],
    },
    projects: {},
  },
} as GatewayConfig;

const orchestratorConfig: OrchestratorConfig = {
  enabled: true,
  poll_interval_ms: 30_000,
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
  source: SubagentListItem["source"]
): SubagentListItem {
  return {
    slug: `${source}-${status}`,
    status,
    source,
  };
}

describe("orchestrator dispatcher", () => {
  it("dispatches Workers for eligible todo projects with orchestrator source", async () => {
    const spawned: SpawnSubagentInput[] = [];
    const listSubagents = vi.fn(async () => ({
      ok: true as const,
      data: { items: [] },
    }));

    const result = await dispatchOrchestratorTick(
      config,
      orchestratorConfig,
      {
        listProjects: async () => ({
          ok: true,
          data: [project("PRO-1"), project("PRO-2"), project("PRO-3")],
        }),
        listSubagents,
        spawnSubagent: async (_config, input) => {
          spawned.push(input);
          return { ok: true, data: { slug: input.slug } };
        },
        now: () => new Date("2026-05-03T00:00:00.000Z"),
        log: () => {},
      }
    );

    expect(result.availableSlots).toBe(2);
    expect(result.eligible).toBe(3);
    expect(spawned).toHaveLength(2);
    expect(spawned.map((input) => input.projectId)).toEqual([
      "PRO-1",
      "PRO-2",
    ]);
    expect(spawned.every((input) => input.source === "orchestrator")).toBe(
      true
    );
    expect(spawned.every((input) => input.cli === "codex")).toBe(true);
    expect(spawned.every((input) => input.mode === "clone")).toBe(true);
  });

  it("counts only running orchestrator runs against status slots", async () => {
    const spawned: SpawnSubagentInput[] = [];

    const result = await dispatchOrchestratorTick(
      config,
      orchestratorConfig,
      {
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
        log: () => {},
      }
    );

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
          data: [project("PRO-1"), project("PRO-2", "review"), project("PRO-3")],
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
        log: () => {},
      }
    );

    expect(result.running).toBe(1);
    expect(result.eligible).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.projectId).toBe("PRO-3");
  });
});
