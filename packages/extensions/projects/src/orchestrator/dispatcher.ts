import * as path from "node:path";
import {
  buildRolePrompt,
  type GatewayConfig,
  type ProjectStatus,
  type SubagentRuntimeProfile,
} from "@aihub/shared";
import { listProjects, type ProjectListItem } from "../projects/store.js";
import {
  listSubagents,
  type SubagentListItem,
} from "../subagents/index.js";
import {
  spawnSubagent,
  type SpawnSubagentInput,
  type SpawnSubagentResult,
  type SubagentMode,
} from "../subagents/runner.js";
import type { OrchestratorConfig } from "./config.js";

type Logger = (message: string) => void;

export type OrchestratorDispatcherDeps = {
  listProjects?: typeof listProjects;
  listSubagents?: typeof listSubagents;
  spawnSubagent?: typeof spawnSubagent;
  now?: () => Date;
  log?: Logger;
};

export type DispatchDecision = {
  projectId: string;
  action: "spawned" | "skipped";
  reason?: string;
  slug?: string;
};

export type DispatchResult = {
  running: number;
  availableSlots: number;
  eligible: number;
  decisions: DispatchDecision[];
};

const STATUS: ProjectStatus = "todo";

function keyValueLog(log: Logger, data: Record<string, string | number>): void {
  log(
    Object.entries(data)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ")
  );
}

function statusOf(project: ProjectListItem): string {
  return typeof project.frontmatter.status === "string"
    ? project.frontmatter.status
    : "";
}

function sourceOf(run: SubagentListItem): string {
  return run.source ?? "manual";
}

function isActiveOrchestratorRun(run: SubagentListItem): boolean {
  return sourceOf(run) === "orchestrator" && run.status === "running";
}

function runtimeProfiles(config: GatewayConfig): SubagentRuntimeProfile[] {
  const extensionProfiles = config.extensions?.subagents?.profiles ?? [];
  const legacyProfiles = (config.subagents ?? []).map((profile) => ({
    name: profile.name,
    cli: profile.cli,
    model: profile.model,
    reasoningEffort: profile.reasoning,
    labelPrefix: profile.name,
    runMode: profile.runMode,
  }));
  return [
    ...extensionProfiles,
    ...legacyProfiles.filter(
      (legacy) =>
        !extensionProfiles.some((profile) => profile.name === legacy.name)
    ),
  ];
}

function resolveProfile(
  config: GatewayConfig,
  name: string
): SubagentRuntimeProfile | undefined {
  return runtimeProfiles(config).find((profile) => profile.name === name);
}

function normalizeRunMode(value: string | undefined): SubagentMode | undefined {
  if (value === "main-run") return "main-run";
  if (value === "worktree") return "worktree";
  if (value === "clone") return "clone";
  if (value === "none") return "none";
  return undefined;
}

function slugFor(projectId: string, now: Date, index: number): string {
  const stamp = now.getTime().toString(36);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `orchestrator-${projectId.toLowerCase()}-${stamp}${suffix}`;
}

function buildWorkerSpawnInput(
  config: GatewayConfig,
  project: ProjectListItem,
  profile: SubagentRuntimeProfile,
  slug: string
): SpawnSubagentInput {
  const specsPath = path.join(project.absolutePath, "SPECS.md");
  const repo =
    typeof project.frontmatter.repo === "string"
      ? project.frontmatter.repo
      : undefined;
  return {
    projectId: project.id,
    slug,
    cli: profile.cli,
    name: profile.name,
    prompt: buildRolePrompt({
      role: "worker",
      title: project.title,
      status: STATUS,
      path: project.absolutePath,
      content: "",
      specsPath,
      projectFiles: ["README.md", "THREAD.md", "SPECS.md", "TASKS.md"],
      projectId: project.id,
      repo,
      customPrompt: [
        "## Orchestrator Handoff",
        "Read SPECS.md, TASKS.md, and VALIDATION.md if present.",
        "When all VALIDATION.md criteria pass, run `aihub projects move " +
          `${project.id} review\` and exit.`,
      ].join("\n"),
    }),
    model: profile.model,
    reasoningEffort: profile.reasoningEffort ?? profile.reasoning,
    mode: normalizeRunMode(profile.runMode),
    source: "orchestrator",
  };
}

export async function dispatchOrchestratorTick(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  deps: OrchestratorDispatcherDeps = {}
): Promise<DispatchResult> {
  const log = deps.log ?? console.log;
  const todoConfig = orchestratorConfig.statuses.todo;
  if (!todoConfig) {
    keyValueLog(log, {
      component: "orchestrator",
      status: STATUS,
      action: "skip",
      reason: "status_not_configured",
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  const profile = resolveProfile(config, todoConfig.profile);
  if (!profile) {
    keyValueLog(log, {
      component: "orchestrator",
      status: STATUS,
      action: "skip",
      reason: "profile_not_found",
      profile: todoConfig.profile,
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  const projectResult = await (deps.listProjects ?? listProjects)(config);
  if (!projectResult.ok) {
    keyValueLog(log, {
      component: "orchestrator",
      status: STATUS,
      action: "error",
      reason: "list_projects_failed",
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  const todoProjects = projectResult.data.filter(
    (project) => statusOf(project) === STATUS
  );
  const projectRuns = await Promise.all(
    todoProjects.map(async (project) => {
      const result = await (deps.listSubagents ?? listSubagents)(
        config,
        project.id
      );
      return {
        project,
        runs: result.ok ? result.data.items : [],
      };
    })
  );

  const activeByProject = new Map<string, SubagentListItem[]>();
  for (const entry of projectRuns) {
    activeByProject.set(
      entry.project.id,
      entry.runs.filter(isActiveOrchestratorRun)
    );
  }

  const running = [...activeByProject.values()].reduce(
    (sum, runs) => sum + runs.length,
    0
  );
  const availableSlots = Math.max(0, todoConfig.max_concurrent - running);
  const eligible = todoProjects.filter(
    (project) => (activeByProject.get(project.id)?.length ?? 0) === 0
  );
  const selected = eligible.slice(0, availableSlots);
  const decisions: DispatchDecision[] = [];

  keyValueLog(log, {
    component: "orchestrator",
    status: STATUS,
    action: "tick",
    running,
    eligible: eligible.length,
    available_slots: availableSlots,
  });

  const now = deps.now ?? (() => new Date());
  for (const [index, project] of selected.entries()) {
    const slug = slugFor(project.id, now(), index);
    const input = buildWorkerSpawnInput(config, project, profile, slug);
    const spawned: SpawnSubagentResult = await (
      deps.spawnSubagent ?? spawnSubagent
    )(config, input);
    if (!spawned.ok) {
      decisions.push({
        projectId: project.id,
        action: "skipped",
        reason: spawned.error,
      });
      keyValueLog(log, {
        component: "orchestrator",
        status: STATUS,
        action: "spawn_failed",
        project: project.id,
        reason: spawned.error,
      });
      continue;
    }
    decisions.push({ projectId: project.id, action: "spawned", slug });
    keyValueLog(log, {
      component: "orchestrator",
      status: STATUS,
      action: "spawned",
      project: project.id,
      slug,
      profile: todoConfig.profile,
    });
  }

  return {
    running,
    availableSlots,
    eligible: eligible.length,
    decisions,
  };
}
