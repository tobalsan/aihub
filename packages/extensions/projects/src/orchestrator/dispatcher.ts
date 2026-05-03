import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  expandPath,
  type GatewayConfig,
  type ProjectsOrchestratorStatusConfig,
  type SubagentRuntimeProfile,
} from "@aihub/shared";
import {
  listProjects,
  type ProjectListItem,
} from "../projects/store.js";
import {
  listSlices,
  updateSlice,
  type SliceRecord,
} from "../projects/slices.js";
import { listSubagents, type SubagentListItem } from "../subagents/index.js";
import {
  spawnSubagent,
  type SpawnSubagentInput,
  type SpawnSubagentResult,
  type SubagentMode,
} from "../subagents/runner.js";
import type { OrchestratorConfig } from "./config.js";
import { getProjectsWorktreeRoot } from "../util/paths.js";

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
  listSlices?: typeof listSlices;
  listSubagents?: typeof listSubagents;
  spawnSubagent?: typeof spawnSubagent;
  updateSlice?: typeof updateSlice;
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
  sliceId?: string;
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

// Slice status that triggers Worker dispatch (slices in this status under
// active projects are eligible for Worker spawning).
const WORKER_SLICE_STATUS = "todo";
// Slice status that triggers Reviewer dispatch.
const REVIEWER_SLICE_STATUS = "review";

/** A slice paired with its resolved parent project info. */
export type SliceDispatchItem = {
  slice: SliceRecord;
  project: ProjectListItem;
};

function keyValueLog(log: Logger, data: Record<string, string | number>): void {
  log(
    Object.entries(data)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ")
  );
}

function projectStatus(project: ProjectListItem): string {
  return typeof project.frontmatter.status === "string"
    ? project.frontmatter.status
    : "";
}

function sourceOf(run: SubagentListItem): string {
  return run.source ?? "manual";
}

export function isActiveOrchestratorRun(
  run: SubagentListItem,
  sliceId?: string,
  fallbackCwds: string[] = []
): boolean {
  if (sourceOf(run) !== "orchestrator" || run.status !== "running") {
    return false;
  }
  if (!sliceId) return true;
  if (run.sliceId) return run.sliceId === sliceId;
  if (!run.worktreePath) return false;
  const worktreePath = run.worktreePath;
  return fallbackCwds.some(
    (fallback) =>
      worktreePath === fallback || worktreePath.startsWith(`${fallback}/`)
  );
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
  statusKey: string
): ProjectsOrchestratorStatusConfig | undefined {
  const value = (orchestratorConfig.statuses as Record<string, unknown>)[statusKey];
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
    run.name === statusConfigFor(orchestratorConfig, WORKER_SLICE_STATUS)?.profile
  );
}

function runStartedAt(run: SubagentListItem): number {
  const parsed = Date.parse(run.startedAt ?? run.lastActive ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentWorkerWorkspaces(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  runs: SubagentListItem[],
  sliceId?: string
) {
  return runs
    .filter(
      (run) =>
        sourceOf(run) === "orchestrator" &&
        isWorkerRun(config, orchestratorConfig, run) &&
        Boolean(run.worktreePath) &&
        // If sliceId provided, only include runs for this slice
        (sliceId === undefined || run.sliceId === sliceId)
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

/**
 * Generate a slug for a slice-based Worker spawn.
 * Results in worktree path: <worktreeRoot>/<PRO-XXX>/<PRO-XXX-Snn>-<stamp>
 * which satisfies §5.8 layout: <worktreeDir>/<PRO-XXX>/<PRO-XXX-Snn>-<slug>
 */
function slugForSlice(sliceId: string, now: Date, index: number): string {
  const stamp = now.getTime().toString(36);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `${sliceId.toLowerCase()}-${stamp}${suffix}`;
}

/**
 * Build the Worker prompt for a slice dispatch.
 *
 * The runner (spawnSubagent) auto-prepends a project summary (README +
 * SCOPE_MAP from the project directory). This prompt adds slice-specific
 * context and instructions.
 */
function buildSliceWorkerPrompt({
  sliceId,
  sliceTitle,
  projectDirPath,
  sliceDirPath,
  aihubCli,
}: {
  sliceId: string;
  sliceTitle: string;
  projectDirPath: string;
  sliceDirPath: string;
  aihubCli: string;
}): string {
  return [
    `## Working on Slice: ${sliceId} — ${sliceTitle}`,
    "",
    "## Project Context (read-only)",
    `Project folder: ${projectDirPath}`,
    `- [README.md](${projectDirPath}/README.md) — project pitch`,
    `- [SCOPE_MAP.md](${projectDirPath}/SCOPE_MAP.md) — sibling slice index`,
    "",
    "## Your Slice",
    `Slice folder: ${sliceDirPath}`,
    `- [README.md](${sliceDirPath}/README.md) — must/nice requirements`,
    `- [SPECS.md](${sliceDirPath}/SPECS.md) — specification`,
    `- [TASKS.md](${sliceDirPath}/TASKS.md) — task checklist`,
    `- [VALIDATION.md](${sliceDirPath}/VALIDATION.md) — done criteria`,
    "",
    "## Your Role: Worker",
    "Implement the assigned tasks in your repository workspace.",
    "Read your slice docs to understand what must be built.",
    "Commit your implementation once checks are green.",
    "",
    "## Scope Constraint — Stay in Your Slice",
    `You must not modify files outside your slice directory (${sliceDirPath}/).`,
    "Do not modify project-level docs (README.md, SCOPE_MAP.md, THREAD.md)",
    "or other slices' files without explicit instruction.",
    "",
    "## Orchestrator Handoff",
    "Read SPECS.md, TASKS.md, and VALIDATION.md inside your slice directory.",
    `For any \`aihub\` CLI calls, invoke \`${aihubCli}\` (this targets the gateway that owns this project - prod or dev).`,
    `When all VALIDATION.md criteria pass, run \`${aihubCli} slices move ${sliceId} review\` and exit.`,
  ].join("\n").trim();
}

function buildWorkerSpawnInput(
  config: GatewayConfig,
  item: SliceDispatchItem,
  profile: SubagentRuntimeProfile,
  slug: string
): SpawnSubagentInput {
  const { slice, project } = item;
  const sliceDirPath = slice.dirPath;
  const projectDirPath = project.absolutePath;
  const repo =
    typeof project.frontmatter.repo === "string"
      ? project.frontmatter.repo
      : undefined;
  return {
    projectId: project.id,
    sliceId: slice.id,
    slug,
    cli: profile.cli,
    name: profile.name,
    prompt: buildSliceWorkerPrompt({
      sliceId: slice.id,
      sliceTitle: slice.frontmatter.title,
      projectDirPath,
      sliceDirPath,
      aihubCli: resolveAihubCli(),
    }),
    model: profile.model,
    reasoningEffort: profile.reasoningEffort ?? profile.reasoning,
    mode: normalizeRunMode(profile.runMode),
    source: "orchestrator",
    ...(repo ? {} : {}), // repo resolved by runner from project frontmatter
  };
}

function buildReviewerSpawnInput(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  item: SliceDispatchItem,
  profile: SubagentRuntimeProfile,
  slug: string,
  runs: SubagentListItem[]
): SpawnSubagentInput {
  const { slice, project } = item;
  const sliceDirPath = slice.dirPath;
  const projectDirPath = project.absolutePath;
  const specsPath = path.join(sliceDirPath, "SPECS.md");
  const repo =
    typeof project.frontmatter.repo === "string"
      ? project.frontmatter.repo
      : undefined;
  const cli = resolveAihubCli();

  // Build reviewer prompt inline (similar to current reviewer, but slice-aware)
  const workerWorkspaces = recentWorkerWorkspaces(
    config,
    orchestratorConfig,
    runs,
    slice.id
  );
  const workspacesBlock =
    workerWorkspaces.length > 0
      ? [
          "## Active Worker Workspaces",
          ...workerWorkspaces.map(
            (item) => `- ${item.name} (${item.cli || "agent"}): ${item.path}`
          ),
        ].join("\n")
      : "## Active Worker Workspaces\nNo active worker workspaces found.";

  const prompt = [
    `## Reviewing Slice: ${slice.id} — ${slice.frontmatter.title}`,
    "",
    "## Project Context (read-only)",
    `Project folder: ${projectDirPath}`,
    `- [README.md](${projectDirPath}/README.md)`,
    `- [SCOPE_MAP.md](${projectDirPath}/SCOPE_MAP.md)`,
    "",
    "## Slice Docs",
    `Slice folder: ${sliceDirPath}`,
    `- [README.md](${sliceDirPath}/README.md)`,
    `- [SPECS.md](${sliceDirPath}/SPECS.md)`,
    `- [TASKS.md](${sliceDirPath}/TASKS.md)`,
    `- [VALIDATION.md](${sliceDirPath}/VALIDATION.md)`,
    "",
    workspacesBlock,
    "",
    "## Your Role: Reviewer",
    "Review the worker's implementation against SPECS.md / TASKS.md / VALIDATION.md.",
    "Worker workspaces are listed above; inspect their diffs and run their tests as needed.",
    `For any \`aihub\` CLI calls, invoke \`${cli}\` (this targets the gateway that owns this project - prod or dev).`,
    "",
    "Decision protocol:",
    `- If ALL VALIDATION.md criteria pass: run \`${cli} slices comment ${slice.id} "<one-line PASS summary>"\` then \`${cli} slices move ${slice.id} ready_to_merge\`. Exit.`,
    `- If ANY criterion fails or the diff has blocking issues: run \`${cli} slices comment ${slice.id} "<crisp list of gaps, file:line where applicable>"\` then \`${cli} slices move ${slice.id} todo\`. Exit.`,
    "",
    "Do NOT move to `done` - that's a manual merge gate. Do NOT push, do NOT merge.",
  ].join("\n").trim();

  return {
    projectId: project.id,
    sliceId: slice.id,
    slug,
    cli: profile.cli,
    name: profile.name,
    prompt,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort ?? profile.reasoning,
    mode: normalizeRunMode(profile.runMode),
    source: "orchestrator",
  };
}

function fallbackCwdsForProject(
  config: GatewayConfig,
  project: ProjectListItem
): string[] {
  const candidates = new Set<string>();
  const repo = project.frontmatter.repo;
  if (typeof repo === "string" && repo.trim()) {
    candidates.add(expandPath(repo.trim()).replace(/\/$/, ""));
  }
  candidates.add(path.join(getProjectsWorktreeRoot(config), project.id));
  candidates.add(project.absolutePath);
  return [...candidates];
}

function configuredStatusKeys(
  orchestratorConfig: OrchestratorConfig
): string[] {
  return Object.keys(orchestratorConfig.statuses).filter((key) =>
    Boolean(statusConfigFor(orchestratorConfig, key))
  );
}

async function dispatchForStatus(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  statusKey: string,
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

  // Only support todo (Worker) and review (Reviewer) slice statuses for now.
  // Other status keys are not dispatched.
  if (statusKey !== WORKER_SLICE_STATUS && statusKey !== REVIEWER_SLICE_STATUS) {
    keyValueLog(log, {
      component: "orchestrator",
      status: statusKey,
      action: "skip",
      reason: "unsupported_status",
    });
    return { running: 0, availableSlots: 0, eligible: 0, decisions: [] };
  }

  // --- Step 1: Enumerate active projects ---
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

  const activeProjects = projectResult.data.filter(
    (p) => projectStatus(p) === "active"
  );

  // --- Step 2: For each active project, gather slices in statusKey + runs ---
  const projectData = await Promise.all(
    activeProjects.map(async (project) => {
      const [slicesResult, runsResult] = await Promise.all([
        (deps.listSlices ?? listSlices)(project.absolutePath).then(
          (slices) => slices.filter((s) => s.frontmatter.status === statusKey)
        ),
        (deps.listSubagents ?? listSubagents)(config, project.id).then(
          (r) => (r.ok ? r.data.items : [])
        ),
      ]);
      return { project, slices: slicesResult, runs: runsResult };
    })
  );

  // --- Step 3: Build slice dispatch items ---
  const allItems: Array<SliceDispatchItem & { runs: SubagentListItem[] }> =
    projectData.flatMap(({ project, slices, runs }) =>
      slices.map((slice) => ({ slice, project, runs }))
    );

  // --- Step 4: Active-run deduplication (keyed by sliceId) ---
  const activeBySlice = new Map<string, SubagentListItem[]>();
  for (const item of allItems) {
    const fallbackCwds = fallbackCwdsForProject(config, item.project);
    const active = item.runs.filter((run) =>
      isActiveOrchestratorRun(run, item.slice.id, fallbackCwds)
    );
    activeBySlice.set(item.slice.id, active);
  }

  const running = [...activeBySlice.values()].reduce(
    (sum, runs) => sum + runs.length,
    0
  );
  const availableSlots = Math.max(0, statusConfig.max_concurrent - running);
  const nowDate = (deps.now ?? (() => new Date()))();
  const nowMs = nowDate.getTime();
  const attempts = deps.attempts;
  const cooldownMs = orchestratorConfig.failure_cooldown_ms;

  // --- Step 5: Cooldown filtering (per sliceId) ---
  const eligible = allItems.filter((item) => {
    const sliceId = item.slice.id;
    if ((activeBySlice.get(sliceId)?.length ?? 0) > 0) return false;
    if (attempts?.isCoolingDown(sliceId, nowMs, cooldownMs)) {
      keyValueLog(log, {
        component: "orchestrator",
        status: statusKey,
        action: "skip",
        project: item.project.id,
        slice: sliceId,
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

  for (const [index, item] of selected.entries()) {
    const { slice, project, runs } = item;
    const slug = slugForSlice(slice.id, nowDate, index);

    let input: SpawnSubagentInput | undefined;
    if (statusKey === WORKER_SLICE_STATUS) {
      input = buildWorkerSpawnInput(config, item, profile, slug);
    } else if (statusKey === REVIEWER_SLICE_STATUS) {
      input = buildReviewerSpawnInput(
        config,
        orchestratorConfig,
        item,
        profile,
        slug,
        runs
      );
    }

    if (!input) {
      decisions.push({
        projectId: project.id,
        sliceId: slice.id,
        action: "skipped",
        reason: "unsupported_status",
      });
      continue;
    }

    // Record attempt up-front so cooldown applies even when spawn throws
    // (e.g. `git worktree add failed` from runner.ts).
    attempts?.record(slice.id, nowMs);

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
        sliceId: slice.id,
        action: "skipped",
        reason: spawned.error,
      });
      keyValueLog(log, {
        component: "orchestrator",
        status: statusKey,
        action: "spawn_failed",
        project: project.id,
        slice: slice.id,
        reason: spawned.error,
      });
      // Best-effort orphan cleanup: spawnSubagent may have created the slug
      // directory before failing (e.g. mkdir succeeded, git worktree add
      // failed). Without cleanup, the UI shows ghost agent rows.
      await removeOrphan(path.join(project.absolutePath, "sessions", slug));
      continue;
    }

    decisions.push({
      projectId: project.id,
      sliceId: slice.id,
      action: "spawned",
      slug,
    });
    keyValueLog(log, {
      component: "orchestrator",
      status: statusKey,
      action: "spawned",
      project: project.id,
      slice: slice.id,
      slug,
      profile: statusConfig.profile,
    });

    if (statusKey === WORKER_SLICE_STATUS) {
      // Lock: move slice todo → in_progress when Worker spawned.
      // Project status is unchanged — the project gate (active) is set by
      // the user when ready; only slices move through the kanban.
      try {
        await (deps.updateSlice ?? updateSlice)(
          project.absolutePath,
          slice.id,
          { status: "in_progress" }
        );
      } catch (lockError) {
        keyValueLog(log, {
          component: "orchestrator",
          status: statusKey,
          action: "lock_failed",
          project: project.id,
          slice: slice.id,
          reason: lockError instanceof Error ? lockError.message : String(lockError),
        });
        // Do not unwind the spawn; the run is already started.
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
