import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildRolePrompt,
  type GatewayConfig,
  type ProjectsOrchestratorStatusConfig,
  type ProjectStatus,
  type SubagentRuntimeProfile,
} from "@aihub/shared";
import {
  listProjects,
  updateProject,
  type ProjectListItem,
} from "../projects/store.js";
import { listSubagents, type SubagentListItem } from "../subagents/index.js";
import {
  spawnSubagent,
  type SpawnSubagentInput,
  type SpawnSubagentResult,
  type SubagentMode,
} from "../subagents/runner.js";
import type { OrchestratorConfig } from "./config.js";

type Logger = (message: string) => void;

/**
 * Resolve the actual `aihub` CLI invocation that subagents should use to talk
 * back to *this* gateway. Substituted into spawn prompts at render time so the
 * agent doesn't need to wrangle env vars (and so it works for any CLI harness).
 *
 * - prod gateway → bare `aihub` (global binary, talks to prod's AIHUB_HOME)
 * - dev gateway (started via `pnpm dev`, signalled by AIHUB_DEV=1) → workspace
 *   `aihub:dev` script run from the gateway's cwd, so the worker hits the dev
 *   gateway's CLI build and the dev AIHUB_HOME inherited via env.
 */
export function resolveAihubCli(): string {
  if (process.env.AIHUB_DEV) {
    // AIHUB_WORKSPACE_ROOT is set by scripts/dev.ts (the workspace root
    // where pnpm-workspace.yaml lives). process.cwd() can't be trusted
    // here because `pnpm --filter @aihub/gateway exec ...` cd's into
    // apps/gateway before launching node.
    const root = process.env.AIHUB_WORKSPACE_ROOT ?? process.cwd();
    return `pnpm --dir ${root} aihub:dev`;
  }
  return "aihub";
}

export type OrchestratorAttemptTracker = {
  record(sliceId: string, atMs: number): void;
  isCoolingDown(sliceId: string, nowMs: number, cooldownMs: number): boolean;
  clear(): void;
};

export type OrchestratorDispatcherDeps = {
  listProjects?: typeof listProjects;
  listSubagents?: typeof listSubagents;
  spawnSubagent?: typeof spawnSubagent;
  updateProject?: typeof updateProject;
  now?: () => Date;
  log?: Logger;
  attempts?: OrchestratorAttemptTracker;
  removeOrphanDir?: (dirPath: string) => Promise<void>;
};

async function defaultRemoveOrphanDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup; do not let it crash the tick
  }
}

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

const WORKER_STATUS: ProjectStatus = "todo";
const REVIEWER_STATUS: ProjectStatus = "review";

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

function projectSliceId(project: ProjectListItem): string | undefined {
  return (project as ProjectListItem & { sliceId?: string }).sliceId;
}

function cooldownKeyForProject(project: ProjectListItem): string {
  return projectSliceId(project) ?? project.id;
}

function sourceOf(run: SubagentListItem): string {
  return run.source ?? "manual";
}

export function isActiveOrchestratorRun(
  run: SubagentListItem,
  sliceId?: string,
  fallbackCwd?: string
): boolean {
  if (sourceOf(run) !== "orchestrator" || run.status !== "running") {
    return false;
  }
  if (!sliceId) return true;
  if (run.sliceId) return run.sliceId === sliceId;
  return Boolean(fallbackCwd && run.worktreePath === fallbackCwd);
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

function statusConfigFor(
  orchestratorConfig: OrchestratorConfig,
  statusKey: ProjectStatus
): ProjectsOrchestratorStatusConfig | undefined {
  const value = orchestratorConfig.statuses[statusKey];
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ProjectsOrchestratorStatusConfig>;
  if (typeof candidate.profile !== "string") return undefined;
  return {
    profile: candidate.profile,
    max_concurrent:
      typeof candidate.max_concurrent === "number"
        ? candidate.max_concurrent
        : 1,
  };
}

function profileForRun(
  config: GatewayConfig,
  run: SubagentListItem
): SubagentRuntimeProfile | undefined {
  if (!run.name) return undefined;
  return resolveProfile(config, run.name);
}

function isWorkerRun(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  run: SubagentListItem
): boolean {
  const profile = profileForRun(config, run);
  if (profile?.type?.toLowerCase() === "worker") return true;
  return Boolean(
    run.name &&
    run.name === statusConfigFor(orchestratorConfig, WORKER_STATUS)?.profile
  );
}

function runStartedAt(run: SubagentListItem): number {
  const parsed = Date.parse(run.startedAt ?? run.lastActive ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentWorkerWorkspaces(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  runs: SubagentListItem[]
) {
  return runs
    .filter(
      (run) =>
        sourceOf(run) === "orchestrator" &&
        isWorkerRun(config, orchestratorConfig, run) &&
        Boolean(run.worktreePath)
    )
    .sort((a, b) => runStartedAt(b) - runStartedAt(a))
    .slice(0, 1)
    .map((run) => ({
      name: run.name ?? run.slug,
      cli: run.cli,
      path: run.worktreePath ?? "",
    }));
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
      status: WORKER_STATUS,
      path: project.absolutePath,
      content: "",
      specsPath,
      projectFiles: ["README.md", "THREAD.md", "SPECS.md", "TASKS.md"],
      projectId: project.id,
      repo,
      customPrompt: [
        "## Orchestrator Handoff",
        "Read SPECS.md, TASKS.md, and VALIDATION.md if present.",
        `For any \`aihub\` CLI calls, invoke \`${resolveAihubCli()}\` (this targets the gateway that owns this project - prod or dev).`,
        `When all VALIDATION.md criteria pass, run \`${resolveAihubCli()} projects move ${project.id} review\` and exit.`,
      ].join("\n"),
    }),
    model: profile.model,
    reasoningEffort: profile.reasoningEffort ?? profile.reasoning,
    mode: normalizeRunMode(profile.runMode),
    source: "orchestrator",
  };
}

function buildReviewerSpawnInput(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  project: ProjectListItem,
  profile: SubagentRuntimeProfile,
  slug: string,
  runs: SubagentListItem[]
): SpawnSubagentInput {
  const specsPath = path.join(project.absolutePath, "SPECS.md");
  const repo =
    typeof project.frontmatter.repo === "string"
      ? project.frontmatter.repo
      : undefined;
  const cli = resolveAihubCli();
  return {
    projectId: project.id,
    slug,
    cli: profile.cli,
    name: profile.name,
    prompt: buildRolePrompt({
      role: "reviewer",
      title: project.title,
      status: REVIEWER_STATUS,
      path: project.absolutePath,
      content: "",
      specsPath,
      projectFiles: ["README.md", "THREAD.md", "SPECS.md", "TASKS.md"],
      projectId: project.id,
      repo,
      workerWorkspaces: recentWorkerWorkspaces(
        config,
        orchestratorConfig,
        runs
      ),
      customPrompt: [
        "## Orchestrator Handoff",
        "Review the worker's implementation against SPECS.md / TASKS.md / VALIDATION.md.",
        "Worker workspaces are listed above; inspect their diffs and run their tests as needed.",
        `For any \`aihub\` CLI calls, invoke \`${cli}\` (this targets the gateway that owns this project - prod or dev).`,
        "",
        "Decision protocol:",
        `- If ALL VALIDATION.md criteria pass: run \`${cli} projects comment ${project.id} "<one-line PASS summary>"\` then \`${cli} projects move ${project.id} ready_to_merge\`. Exit.`,
        `- If ANY criterion fails or the diff has blocking issues: run \`${cli} projects comment ${project.id} "<crisp list of gaps, file:line where applicable>"\` then \`${cli} projects move ${project.id} todo\`. Exit.`,
        "",
        "Do NOT move to `done` - that's Thinh's manual merge gate. Do NOT push, do NOT merge.",
      ].join("\n"),
    }),
    model: profile.model,
    reasoningEffort: profile.reasoningEffort ?? profile.reasoning,
    mode: normalizeRunMode(profile.runMode),
    source: "orchestrator",
  };
}

function buildSpawnInput(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  statusKey: ProjectStatus,
  project: ProjectListItem,
  profile: SubagentRuntimeProfile,
  slug: string,
  runs: SubagentListItem[]
): SpawnSubagentInput | undefined {
  if (statusKey === WORKER_STATUS) {
    return buildWorkerSpawnInput(config, project, profile, slug);
  }
  if (statusKey === REVIEWER_STATUS) {
    return buildReviewerSpawnInput(
      config,
      orchestratorConfig,
      project,
      profile,
      slug,
      runs
    );
  }
  return undefined;
}

async function dispatchForStatus(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  statusKey: ProjectStatus,
  deps: OrchestratorDispatcherDeps
): Promise<DispatchResult> {
  const log = deps.log ?? console.log;
  const statusConfig = statusConfigFor(orchestratorConfig, statusKey);
  if (!statusConfig) {
    keyValueLog(log, {
      component: "orchestrator",
      status: statusKey,
      action: "skip",
      reason: "status_not_configured",
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  const profile = resolveProfile(config, statusConfig.profile);
  if (!profile) {
    keyValueLog(log, {
      component: "orchestrator",
      status: statusKey,
      action: "skip",
      reason: "profile_not_found",
      profile: statusConfig.profile,
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  if (statusKey !== WORKER_STATUS && statusKey !== REVIEWER_STATUS) {
    keyValueLog(log, {
      component: "orchestrator",
      status: statusKey,
      action: "skip",
      reason: "unsupported_status",
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  const projectResult = await (deps.listProjects ?? listProjects)(config);
  if (!projectResult.ok) {
    keyValueLog(log, {
      component: "orchestrator",
      status: statusKey,
      action: "error",
      reason: "list_projects_failed",
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  const statusProjects = projectResult.data.filter(
    (project) => statusOf(project) === statusKey
  );
  const projectRuns = await Promise.all(
    statusProjects.map(async (project) => {
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
      entry.runs.filter((run) =>
        isActiveOrchestratorRun(
          run,
          projectSliceId(entry.project),
          entry.project.absolutePath
        )
      )
    );
  }

  const running = [...activeByProject.values()].reduce(
    (sum, runs) => sum + runs.length,
    0
  );
  const availableSlots = Math.max(0, statusConfig.max_concurrent - running);
  const nowDate = (deps.now ?? (() => new Date()))();
  const nowMs = nowDate.getTime();
  const attempts = deps.attempts;
  const cooldownMs = orchestratorConfig.failure_cooldown_ms;
  const eligible = statusProjects.filter((project) => {
    if ((activeByProject.get(project.id)?.length ?? 0) > 0) return false;
    const cooldownKey = cooldownKeyForProject(project);

    if (attempts?.isCoolingDown(cooldownKey, nowMs, cooldownMs)) {
      keyValueLog(log, {
        component: "orchestrator",
        status: statusKey,
        action: "skip",
        project: project.id,
        reason: "failure_cooldown",
      });
      return false;
    }
    return true;
  });
  const selected = eligible.slice(0, availableSlots);
  const decisions: DispatchDecision[] = [];

  keyValueLog(log, {
    component: "orchestrator",
    status: statusKey,
    action: "tick",
    running,
    eligible: eligible.length,
    available_slots: availableSlots,
  });

  const removeOrphan = deps.removeOrphanDir ?? defaultRemoveOrphanDir;
  for (const [index, project] of selected.entries()) {
    const slug = slugFor(project.id, nowDate, index);
    const input = buildSpawnInput(
      config,
      orchestratorConfig,
      statusKey,
      project,
      profile,
      slug,
      projectRuns.find((entry) => entry.project.id === project.id)?.runs ?? []
    );
    if (!input) {
      decisions.push({
        projectId: project.id,
        action: "skipped",
        reason: "unsupported_status",
      });
      continue;
    }
    // Record attempt up-front so cooldown applies even when spawn throws
    // (e.g. `git worktree add failed` from runner.ts).
    attempts?.record(cooldownKeyForProject(project), nowMs);
    let spawned: SpawnSubagentResult;
    try {
      spawned = await (deps.spawnSubagent ?? spawnSubagent)(config, input);
    } catch (error) {
      spawned = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!spawned.ok) {
      decisions.push({
        projectId: project.id,
        action: "skipped",
        reason: spawned.error,
      });
      keyValueLog(log, {
        component: "orchestrator",
        status: statusKey,
        action: "spawn_failed",
        project: project.id,
        reason: spawned.error,
      });
      // Best-effort orphan cleanup: spawnSubagent may have created the slug
      // directory before failing (e.g. mkdir succeeded, git worktree add
      // failed). Without cleanup, the UI shows ghost agent rows and the
      // session dir accumulates per failed tick.
      await removeOrphan(path.join(project.absolutePath, "sessions", slug));
      continue;
    }
    decisions.push({ projectId: project.id, action: "spawned", slug });
    keyValueLog(log, {
      component: "orchestrator",
      status: statusKey,
      action: "spawned",
      project: project.id,
      slug,
      profile: statusConfig.profile,
    });

    if (statusKey === WORKER_STATUS) {
      // Lock only the todo worker phase. Review intentionally has no lock
      // status; active-run dedupe plus cooldown handles duplicate defense.
      const update = await (deps.updateProject ?? updateProject)(
        config,
        project.id,
        {
          status: "in_progress",
        }
      );
      if (!update.ok) {
        keyValueLog(log, {
          component: "orchestrator",
          status: statusKey,
          action: "lock_failed",
          project: project.id,
          reason: update.error,
        });
      }
    }
  }

  return {
    running,
    availableSlots,
    eligible: eligible.length,
    decisions,
  };
}

function configuredStatusKeys(
  orchestratorConfig: OrchestratorConfig
): ProjectStatus[] {
  return Object.keys(orchestratorConfig.statuses).filter(
    (key): key is ProjectStatus =>
      Boolean(statusConfigFor(orchestratorConfig, key as ProjectStatus))
  );
}

export async function dispatchOrchestratorTick(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  deps: OrchestratorDispatcherDeps = {}
): Promise<DispatchResult> {
  const results: DispatchResult[] = [];
  for (const statusKey of configuredStatusKeys(orchestratorConfig)) {
    results.push(
      await dispatchForStatus(config, orchestratorConfig, statusKey, deps)
    );
  }
  return results.reduce<DispatchResult>(
    (total, result) => ({
      running: total.running + result.running,
      availableSlots: total.availableSlots + result.availableSlots,
      eligible: total.eligible + result.eligible,
      decisions: [...total.decisions, ...result.decisions],
    }),
    { running: 0, availableSlots: 0, eligible: 0, decisions: [] }
  );
}
