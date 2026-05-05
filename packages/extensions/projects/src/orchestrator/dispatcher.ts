import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  expandPath,
  type GatewayConfig,
  type ProjectsOrchestratorStatusConfig,
  type SubagentRuntimeProfile,
} from "@aihub/shared";
import { listProjects, type ProjectListItem } from "../projects/store.js";
import { ensureProjectIntegrationBranch } from "../projects/branches.js";
import {
  listSlices,
  updateSlice,
  type SliceRecord,
  type SliceStatus,
} from "../projects/slices.js";
import { listSubagents, type SubagentListItem } from "../subagents/index.js";
import {
  interruptSubagent,
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

export type OrchestratorDispatchKind = "worker" | "reviewer" | "merger";

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

export type OrchestratorAttemptTracker = {
  recordFailure(
    sliceId: string,
    kind: OrchestratorDispatchKind,
    atMs: number
  ): void;
  recordSuccess(sliceId: string, kind: OrchestratorDispatchKind): void;
  isCoolingDown(
    sliceId: string,
    kind: OrchestratorDispatchKind,
    nowMs: number
  ): boolean;
  clear(): void;
};

export function createOrchestratorAttemptTracker(): OrchestratorAttemptTracker {
  const backoffs = new Map<
    string,
    { nextAttempt: number; failureCount: number }
  >();

  const key = (sliceId: string, kind: OrchestratorDispatchKind): string =>
    `${sliceId}:${kind}`;

  return {
    recordFailure(sliceId, kind, atMs): void {
      const attemptKey = key(sliceId, kind);
      const previous = backoffs.get(attemptKey);
      const failureCount = (previous?.failureCount ?? 0) + 1;
      const delay = Math.min(
        BACKOFF_BASE_MS * 2 ** (failureCount - 1),
        BACKOFF_MAX_MS
      );
      backoffs.set(attemptKey, {
        failureCount,
        nextAttempt: atMs + delay,
      });
    },
    recordSuccess(sliceId, kind): void {
      backoffs.delete(key(sliceId, kind));
    },
    isCoolingDown(sliceId, kind, nowMs): boolean {
      const entry = backoffs.get(key(sliceId, kind));
      return entry !== undefined && nowMs < entry.nextAttempt;
    },
    clear(): void {
      backoffs.clear();
    },
  };
}

export type OrchestratorStallTracker = {
  recordStatus(sliceId: string, status: SliceStatus): boolean;
  isReported(sliceId: string, status: SliceStatus, runKey: string): boolean;
  markReported(sliceId: string, status: SliceStatus, runKey: string): void;
  clear(): void;
};

export type OrchestratorDispatcherDeps = {
  listProjects?: typeof listProjects;
  listSlices?: typeof listSlices;
  listSubagents?: typeof listSubagents;
  spawnSubagent?: typeof spawnSubagent;
  ensureProjectIntegrationBranch?: typeof ensureProjectIntegrationBranch;
  interruptSubagent?: typeof interruptSubagent;
  updateSlice?: typeof updateSlice;
  now?: () => Date;
  log?: Logger;
  attempts?: OrchestratorAttemptTracker;
  stalls?: OrchestratorStallTracker;
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

export type ReconcileDecision = {
  projectId: string;
  sliceId: string;
  slug: string;
  action: "interrupted" | "skipped";
  reason?: string;
};

export type ReconcileResult = {
  inspected: number;
  interrupted: number;
  decisions: ReconcileDecision[];
};

// Slice status that triggers Worker dispatch (slices in this status under
// active projects are eligible for Worker spawning).
const WORKER_SLICE_STATUS = "todo";
// Slice status that triggers Reviewer dispatch.
const REVIEWER_SLICE_STATUS = "review";
// Slice status that triggers Merger dispatch.
const MERGER_SLICE_STATUS = "ready_to_merge";
const STALL_SLICE_STATUSES = new Set<SliceStatus>(["in_progress", "review"]);
const ORCHESTRATOR_STALL_AUTHOR = "Orchestrator";

/** A slice paired with its resolved parent project info. */
export type SliceDispatchItem = {
  slice: SliceRecord;
  project: ProjectListItem;
};

function keyValueLog(
  log: Logger,
  data: Record<string, string | number | string[]>
): void {
  log(
    Object.entries(data)
      .map(
        ([key, value]) =>
          `${key}=${Array.isArray(value) ? value.join(",") : String(value)}`
      )
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

export function createStallTracker(): OrchestratorStallTracker {
  const lastStatus = new Map<string, SliceStatus>();
  const reported = new Set<string>();
  return {
    recordStatus(sliceId: string, status: SliceStatus): boolean {
      const previous = lastStatus.get(sliceId);
      if (previous !== undefined && previous !== status) {
        for (const key of reported) {
          if (key.startsWith(`${sliceId}:`)) reported.delete(key);
        }
      }
      lastStatus.set(sliceId, status);
      return previous !== status;
    },
    isReported(sliceId: string, status: SliceStatus, runKey: string): boolean {
      return reported.has(`${sliceId}:${status}:${runKey}`);
    },
    markReported(sliceId: string, status: SliceStatus, runKey: string): void {
      reported.add(`${sliceId}:${status}:${runKey}`);
    },
    clear(): void {
      lastStatus.clear();
      reported.clear();
    },
  };
}

const TERMINAL_BLOCKER_STATUSES = new Set<SliceStatus>([
  "done",
  "ready_to_merge",
  "cancelled",
]);

function blockedBy(slice: SliceRecord): string[] {
  const value = slice.frontmatter.blocked_by;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function pendingBlockers(
  slice: SliceRecord,
  sliceStatusIndex: Map<string, SliceStatus>
): string[] {
  return blockedBy(slice).filter((blockerId) => {
    const status = sliceStatusIndex.get(blockerId);
    return !status || !TERMINAL_BLOCKER_STATUSES.has(status);
  });
}

async function buildGlobalSliceStatusIndex(
  config: GatewayConfig,
  deps: OrchestratorDispatcherDeps
): Promise<Map<string, SliceStatus>> {
  const index = new Map<string, SliceStatus>();
  const projectResult = await (deps.listProjects ?? listProjects)(config);
  if (!projectResult.ok) return index;

  await Promise.all(
    projectResult.data.map(async (project) => {
      const slices = await (deps.listSlices ?? listSlices)(
        project.absolutePath
      );
      for (const slice of slices) {
        index.set(slice.id, slice.frontmatter.status);
      }
    })
  );

  return index;
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

function isLiveSliceRun(
  run: SubagentListItem,
  sliceId: string,
  fallbackCwds: string[] = []
): boolean {
  if (run.status !== "running") return false;
  if (run.sliceId) return run.sliceId === sliceId;
  const worktreePath = run.worktreePath;
  if (!worktreePath) return false;
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
  const value = (orchestratorConfig.statuses as Record<string, unknown>)[
    statusKey
  ];
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ProjectsOrchestratorStatusConfig>;
  if (typeof candidate.profile !== "string") return undefined;
  return {
    profile: candidate.profile,
    max_concurrent:
      typeof candidate.max_concurrent === "number"
        ? candidate.max_concurrent
        : defaultMaxConcurrentForStatus(statusKey),
  };
}

function defaultMaxConcurrentForStatus(statusKey: string): number {
  return statusKey === MERGER_SLICE_STATUS ? 2 : 1;
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
    run.name ===
      statusConfigFor(orchestratorConfig, WORKER_SLICE_STATUS)?.profile
  );
}

function isMergerRun(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  run: SubagentListItem
): boolean {
  const profile = profileForRun(config, run);
  if (profile?.type?.toLowerCase() === "merger") return true;
  return Boolean(
    run.name &&
    run.name ===
      statusConfigFor(orchestratorConfig, MERGER_SLICE_STATUS)?.profile
  );
}

function expectedStatusForRun(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  run: SubagentListItem
): SliceStatus | undefined {
  const profile = profileForRun(config, run);
  const profileType = profile?.type?.toLowerCase();
  if (profileType === "worker") return "in_progress";
  if (profileType === "reviewer") return "review";
  if (profileType === "merger") return "ready_to_merge";

  for (const statusKey of configuredStatusKeys(orchestratorConfig)) {
    const statusConfig = statusConfigFor(orchestratorConfig, statusKey);
    if (run.name !== statusConfig?.profile) continue;
    if (statusKey === WORKER_SLICE_STATUS) return "in_progress";
    if (
      statusKey === "review" ||
      statusKey === "ready_to_merge" ||
      statusKey === "done" ||
      statusKey === "cancelled"
    ) {
      return statusKey;
    }
  }

  return undefined;
}

export async function reconcileLiveRuns(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  deps: OrchestratorDispatcherDeps = {}
): Promise<ReconcileResult> {
  const log = deps.log ?? console.log;
  const decisions: ReconcileDecision[] = [];
  const projectResult = await (deps.listProjects ?? listProjects)(config);
  if (!projectResult.ok) {
    keyValueLog(log, {
      component: "orchestrator",
      action: "reconcile_failed",
      reason: "list_projects_failed",
    });
    return { inspected: 0, interrupted: 0, decisions };
  }

  for (const project of projectResult.data) {
    const slices = await (deps.listSlices ?? listSlices)(project.absolutePath);
    const sliceStatuses = new Map(
      slices.map((slice) => [slice.id, slice.frontmatter.status])
    );
    const runsResult = await (deps.listSubagents ?? listSubagents)(
      config,
      project.id
    );
    if (!runsResult.ok) {
      keyValueLog(log, {
        component: "orchestrator",
        action: "reconcile_failed",
        project: project.id,
        reason: "list_subagents_failed",
      });
      continue;
    }

    for (const run of runsResult.data.items) {
      if (
        sourceOf(run) !== "orchestrator" ||
        run.status !== "running" ||
        !run.sliceId
      ) {
        continue;
      }

      const expectedStatus = expectedStatusForRun(
        config,
        orchestratorConfig,
        run
      );
      if (!expectedStatus) {
        decisions.push({
          projectId: project.id,
          sliceId: run.sliceId,
          slug: run.slug,
          action: "skipped",
          reason: "unknown_expected_status",
        });
        continue;
      }

      const actualStatus = sliceStatuses.get(run.sliceId);
      if (actualStatus === expectedStatus) {
        decisions.push({
          projectId: project.id,
          sliceId: run.sliceId,
          slug: run.slug,
          action: "skipped",
          reason: "status_matches",
        });
        continue;
      }

      const result = await (deps.interruptSubagent ?? interruptSubagent)(
        config,
        project.id,
        run.slug
      );
      if (result.ok) {
        decisions.push({
          projectId: project.id,
          sliceId: run.sliceId,
          slug: run.slug,
          action: "interrupted",
          reason: actualStatus ? "status_mismatch" : "slice_missing",
        });
        keyValueLog(log, {
          component: "orchestrator",
          action: "reconcile_interrupt",
          project: project.id,
          slice: run.sliceId,
          slug: run.slug,
          expected_status: expectedStatus,
          actual_status: actualStatus ?? "missing",
        });
      } else {
        decisions.push({
          projectId: project.id,
          sliceId: run.sliceId,
          slug: run.slug,
          action: "skipped",
          reason: "interrupt_failed",
        });
        keyValueLog(log, {
          component: "orchestrator",
          action: "reconcile_interrupt_failed",
          project: project.id,
          slice: run.sliceId,
          slug: run.slug,
          reason: result.error,
        });
      }
    }
  }

  return {
    inspected: decisions.length,
    interrupted: decisions.filter((decision) => decision.action === "interrupted")
      .length,
    decisions,
  };
}

function runStartedAt(run: SubagentListItem): number {
  const parsed = Date.parse(run.startedAt ?? run.lastActive ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function runLastActivityAt(run: SubagentListItem): number {
  const parsed = Date.parse(run.lastActive ?? run.startedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function lastRunForSlice(
  runs: SubagentListItem[],
  sliceId: string,
  fallbackCwds: string[]
): SubagentListItem | undefined {
  return runs
    .filter((run) => {
      if (run.sliceId) return run.sliceId === sliceId;
      const worktreePath = run.worktreePath;
      if (!worktreePath) return false;
      return fallbackCwds.some(
        (fallback) =>
          worktreePath === fallback ||
          worktreePath.startsWith(`${fallback}/`)
      );
    })
    .sort((a, b) => runLastActivityAt(b) - runLastActivityAt(a))[0];
}

function lastRunKey(run: SubagentListItem | undefined): string {
  if (!run) return "none";
  return [
    run.slug,
    run.status,
    run.finishedAt ?? run.lastActive ?? run.startedAt ?? "",
    run.lastError ?? "",
  ].join("|");
}

function describeRun(run: SubagentListItem | undefined): string {
  if (!run) return "none";
  const details = [
    run.slug,
    run.status,
    run.lastError ? `error=${run.lastError}` : "",
    run.finishedAt ? `finished=${run.finishedAt}` : "",
  ].filter(Boolean);
  return details.join(" / ");
}

function sliceUpdatedAt(slice: SliceRecord): number {
  const parsed = Date.parse(slice.frontmatter.updated_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function appendThreadComment(
  existing: string,
  body: string,
  now: Date
): string {
  const separator = existing.trim().length > 0 ? "\n\n" : "";
  const entry = [
    `## ${now.toISOString()}`,
    `[author:${ORCHESTRATOR_STALL_AUTHOR}]`,
    `[date:${now.toISOString()}]`,
    "",
    body,
  ].join("\n");
  return `${existing.trimEnd()}${separator}${entry}\n`;
}

async function detectStalls(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  deps: OrchestratorDispatcherDeps
): Promise<void> {
  const thresholdMs = orchestratorConfig.stall_threshold_ms;
  if (thresholdMs <= 0) return;

  const log = deps.log ?? console.log;
  const now = (deps.now ?? (() => new Date()))();
  const nowMs = now.getTime();
  const tracker = deps.stalls;
  if (!tracker) return;

  const projectResult = await (deps.listProjects ?? listProjects)(config);
  if (!projectResult.ok) {
    keyValueLog(log, {
      component: "orchestrator",
      action: "stall_check_failed",
      reason: "list_projects_failed",
    });
    return;
  }

  const activeProjects = projectResult.data.filter(
    (project) => projectStatus(project) === "active"
  );

  await Promise.all(
    activeProjects.map(async (project) => {
      const [slices, runsResult] = await Promise.all([
        (deps.listSlices ?? listSlices)(project.absolutePath),
        (deps.listSubagents ?? listSubagents)(config, project.id),
      ]);
      const runs = runsResult.ok ? runsResult.data.items : [];
      const fallbackCwds = fallbackCwdsForProject(config, project);

      for (const slice of slices) {
        tracker.recordStatus(slice.id, slice.frontmatter.status);
        if (!STALL_SLICE_STATUSES.has(slice.frontmatter.status)) continue;

        const updatedAt = sliceUpdatedAt(slice);
        if (updatedAt === 0 || nowMs - updatedAt < thresholdMs) continue;

        const liveRun = runs.find((run) =>
          isLiveSliceRun(run, slice.id, fallbackCwds)
        );
        if (liveRun) continue;

        const lastRun = lastRunForSlice(runs, slice.id, fallbackCwds);
        const runKey = lastRunKey(lastRun);
        if (tracker.isReported(slice.id, slice.frontmatter.status, runKey)) {
          continue;
        }

        const idleMinutes = Math.floor((nowMs - updatedAt) / 60_000);
        const body = `Stall detected: slice ${slice.id} has been in ${slice.frontmatter.status} for ${idleMinutes}m with no live subagent run. Last run: ${describeRun(lastRun)}.`;
        keyValueLog(log, {
          component: "orchestrator",
          action: "stall_detected",
          project: project.id,
          slice: slice.id,
          status: slice.frontmatter.status,
          idle_minutes: idleMinutes,
          last_run: describeRun(lastRun),
        });

        await (deps.updateSlice ?? updateSlice)(project.absolutePath, slice.id, {
          thread: appendThreadComment(slice.docs.thread, body, now),
        });
        tracker.markReported(slice.id, slice.frontmatter.status, runKey);
      }
    })
  );
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

function recentWorkerBranch(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  runs: SubagentListItem[],
  projectId: string,
  sliceId: string
): string | undefined {
  const latest = runs
    .filter(
      (run) =>
        sourceOf(run) === "orchestrator" &&
        isWorkerRun(config, orchestratorConfig, run) &&
        Boolean(run.slug) &&
        run.sliceId === sliceId
    )
    .sort((a, b) => runStartedAt(b) - runStartedAt(a))[0];
  return latest ? `${projectId}/${latest.slug}` : undefined;
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

function slugForStatus(
  statusKey: string,
  sliceId: string,
  now: Date,
  index: number
): string {
  if (statusKey !== MERGER_SLICE_STATUS)
    return slugForSlice(sliceId, now, index);
  const stamp = now.getTime().toString(36);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `${sliceId.toLowerCase()}-merger-${stamp}${suffix}`;
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
  const signoffInstruction =
    'When posting comments via `aihub projects comment` or `aihub slices comment`, always pass `--author Worker`. Do not let comments default to "AIHub".';
  return [
    `## Working on Slice: ${sliceId} — ${sliceTitle}`,
    "",
    "## Project Context (read-only)",
    `Project folder: ${projectDirPath}`,
    `- [README.md](${projectDirPath}/README.md) — project pitch`,
    `- [SCOPE_MAP.md](${projectDirPath}/SCOPE_MAP.md) — sibling slice index`,
    `- [THREAD.md](${projectDirPath}/THREAD.md) — read for prior Reviewer feedback on this slice`,
    "",
    "## Your Slice",
    `Slice folder: ${sliceDirPath}`,
    `- [README.md](${sliceDirPath}/README.md) — must/nice requirements`,
    `- [SPECS.md](${sliceDirPath}/SPECS.md) — specification (check for \`## Known traps\` before changing anything)`,
    `- [TASKS.md](${sliceDirPath}/TASKS.md) — task checklist`,
    `- [VALIDATION.md](${sliceDirPath}/VALIDATION.md) — done criteria`,
    "",
    "## Your Role: Worker",
    "Implement the assigned tasks in your repository workspace.",
    "Read your slice docs to understand what must be built.",
    "Commit your implementation once checks are green.",
    "",
    "## Prior Iteration Feedback (CRITICAL)",
    "If THREAD.md shows a prior Reviewer rejection on this slice, the latest Reviewer comment is your top priority. Do NOT repeat the rejected approach.",
    "Read `## Known traps` in SPECS.md before changing anything — it captures durable inter-iteration knowledge from previous Workers.",
    "If a failing test looks unrelated to this slice, investigate root cause before band-aiding. If you believe a test is genuinely stale, comment in THREAD.md explaining why instead of editing the assertion.",
    "",
    "## Scope Constraint — Stay in Your Slice",
    `You must not modify files outside your slice directory (${sliceDirPath}/).`,
    "Do not modify project-level docs (README.md, SCOPE_MAP.md, THREAD.md)",
    "or other slices' files without explicit instruction.",
    "",
    "## Orchestrator Handoff",
    "Read SPECS.md, TASKS.md, and VALIDATION.md inside your slice directory.",
    "Also read THREAD.md at the project root for any prior Reviewer feedback.",
    `For any \`aihub\` CLI calls, invoke \`${aihubCli}\` (this targets the gateway that owns this project - prod or dev).`,
    signoffInstruction,
    `When all VALIDATION.md criteria pass, run \`${aihubCli} slices move ${sliceId} review\` and exit.`,
  ]
    .join("\n")
    .trim();
}

async function buildWorkerSpawnInput(
  config: GatewayConfig,
  item: SliceDispatchItem,
  profile: SubagentRuntimeProfile,
  slug: string,
  deps: OrchestratorDispatcherDeps
): Promise<SpawnSubagentInput> {
  const { slice, project } = item;
  const sliceDirPath = slice.dirPath;
  const projectDirPath = project.absolutePath;
  const repo =
    typeof project.frontmatter.repo === "string"
      ? project.frontmatter.repo.trim()
      : "";
  if (!repo) {
    throw new Error("Project repo is required for Worker dispatch");
  }
  const baseBranch = await (
    deps.ensureProjectIntegrationBranch ?? ensureProjectIntegrationBranch
  )(expandPath(repo), project.id);
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
    baseBranch,
    source: "orchestrator",
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
  const cli = resolveAihubCli();
  const signoffInstruction =
    'When posting comments via `aihub projects comment` or `aihub slices comment`, always pass `--author Reviewer`. Do not let comments default to "AIHub".';

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
    signoffInstruction,
    "",
    "Decision protocol:",
    `- If ALL VALIDATION.md criteria pass: run \`${cli} slices comment ${slice.id} --author Reviewer "<one-line PASS summary>"\` then \`${cli} slices move ${slice.id} ready_to_merge\`. Exit.`,
    `- If ANY criterion fails or the diff has blocking issues:`,
    `    1. Run \`${cli} slices comment ${slice.id} --author Reviewer "<crisp list of gaps, file:line where applicable>"\` (this records to THREAD.md).`,
    `    2. Append/update a \`## Known traps\` section in ${sliceDirPath}/SPECS.md so the next Worker reads it. For each new trap, capture three fields:`,
    `       - **Symptom** — failing test name, error, file:line.`,
    `       - **Wrong fix to avoid** — what previous Worker(s) tried that you rejected.`,
    `       - **Correct fix / investigation direction** — what the next Worker should do instead.`,
    `       Keep entries terse. If a matching trap already exists, update it rather than duplicating.`,
    `    3. Run \`${cli} slices move ${slice.id} todo\`. Exit.`,
    "",
    "Do NOT move to `done` - that's a manual merge gate. Do NOT push, do NOT merge.",
  ]
    .join("\n")
    .trim();

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

async function buildMergerSpawnInput(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  item: SliceDispatchItem,
  profile: SubagentRuntimeProfile,
  slug: string,
  runs: SubagentListItem[],
  deps: OrchestratorDispatcherDeps
): Promise<SpawnSubagentInput> {
  const { slice, project } = item;
  const repo =
    typeof project.frontmatter.repo === "string"
      ? project.frontmatter.repo.trim()
      : "";
  if (!repo) {
    throw new Error("Project repo is required for Merger dispatch");
  }

  const baseBranch = await (
    deps.ensureProjectIntegrationBranch ?? ensureProjectIntegrationBranch
  )(expandPath(repo), project.id);
  const cli = resolveAihubCli();
  const workerBranch = recentWorkerBranch(
    config,
    orchestratorConfig,
    runs,
    project.id,
    slice.id
  );
  const mergeTarget = workerBranch ?? "<slice-worker-branch>";
  const signoffInstruction =
    'When posting comments via `aihub slices comment`, always pass `--author Merger`. Do not let comments default to "AIHub".';

  const prompt = [
    `## Merging Slice: ${slice.id} — ${slice.frontmatter.title}`,
    "",
    "## Project Context",
    `Project folder: ${project.absolutePath}`,
    `Slice folder: ${slice.dirPath}`,
    `Integration branch: ${baseBranch}`,
    `Slice branch: ${mergeTarget}`,
    "",
    "## Your Role: Merger",
    "You are running in a worktree forked from the project integration branch.",
    `Run \`git merge ${mergeTarget}\` to merge the slice branch into this integration branch worktree.`,
    "If the merge is clean, commit if needed, then run targeted validation you can discover plus `pnpm typecheck` when available.",
    "If conflicts are trivial, resolve them, commit, and run validation.",
    `On success: run \`${cli} slices comment ${slice.id} --author Merger "Merged to integration."\` then \`${cli} slices move ${slice.id} done\`. Exit.`,
    `On irrecoverable conflict or validation failure: run \`${cli} slices comment ${slice.id} --author Merger "Merge conflict — needs human: <files or failing checks>"\`. Leave the slice in \`ready_to_merge\` and exit.`,
    "Do not push. Do not merge integration into main.",
    signoffInstruction,
  ]
    .join("\n")
    .trim();

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
    baseBranch,
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

function dispatchKindForStatus(
  statusKey: string
): OrchestratorDispatchKind | undefined {
  if (statusKey === WORKER_SLICE_STATUS) return "worker";
  if (statusKey === REVIEWER_SLICE_STATUS) return "reviewer";
  return undefined;
}

async function dispatchForStatus(
  config: GatewayConfig,
  orchestratorConfig: OrchestratorConfig,
  statusKey: string,
  deps: OrchestratorDispatcherDeps,
  globalSliceStatusIndex: Map<string, SliceStatus>
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

  // Only support Worker, Reviewer, and Merger slice statuses for now.
  // Other status keys are not dispatched.
  if (
    statusKey !== WORKER_SLICE_STATUS &&
    statusKey !== REVIEWER_SLICE_STATUS &&
    statusKey !== MERGER_SLICE_STATUS
  ) {
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
        (deps.listSlices ?? listSlices)(project.absolutePath).then((slices) =>
          slices.filter((s) => s.frontmatter.status === statusKey)
        ),
        (deps.listSubagents ?? listSubagents)(config, project.id).then((r) =>
          r.ok ? r.data.items : []
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
    const active = item.runs.filter((run) => {
      if (!isActiveOrchestratorRun(run, item.slice.id, fallbackCwds)) {
        return false;
      }
      if (statusKey === MERGER_SLICE_STATUS) {
        return isMergerRun(config, orchestratorConfig, run);
      }
      return true;
    });
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
  const dispatchKind = dispatchKindForStatus(statusKey);

  // --- Step 5: Blocker + cooldown filtering (per sliceId) ---
  const eligible = allItems.filter((item) => {
    const sliceId = item.slice.id;
    if ((activeBySlice.get(sliceId)?.length ?? 0) > 0) return false;
    const pending = pendingBlockers(item.slice, globalSliceStatusIndex);
    if (pending.length > 0) {
      keyValueLog(log, {
        component: "orchestrator",
        status: statusKey,
        action: "skip",
        project: item.project.id,
        slice: sliceId,
        reason: "blocked_by_pending",
        pending,
      });
      return false;
    }
    if (dispatchKind && attempts?.isCoolingDown(sliceId, dispatchKind, nowMs)) {
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
    const slug = slugForStatus(statusKey, slice.id, nowDate, index);

    let input: SpawnSubagentInput | undefined;
    try {
      if (statusKey === WORKER_SLICE_STATUS) {
        input = await buildWorkerSpawnInput(config, item, profile, slug, deps);
      } else if (statusKey === REVIEWER_SLICE_STATUS) {
        input = buildReviewerSpawnInput(
          config,
          orchestratorConfig,
          item,
          profile,
          slug,
          runs
        );
      } else if (statusKey === MERGER_SLICE_STATUS) {
        input = await buildMergerSpawnInput(
          config,
          orchestratorConfig,
          item,
          profile,
          slug,
          runs,
          deps
        );
      }
    } catch (error) {
      decisions.push({
        projectId: project.id,
        sliceId: slice.id,
        action: "skipped",
        reason: "spawn_failed",
      });
      keyValueLog(log, {
        component: "orchestrator",
        status: statusKey,
        action: "spawn_failed",
        project: project.id,
        slice: slice.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
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
      if (dispatchKind) attempts?.recordFailure(slice.id, dispatchKind, nowMs);
      decisions.push({
        projectId: project.id,
        sliceId: slice.id,
        action: "skipped",
        reason: "spawn_failed",
      });
      if (statusKey === WORKER_SLICE_STATUS) {
        try {
          await (deps.updateSlice ?? updateSlice)(
            project.absolutePath,
            slice.id,
            { status: "todo" }
          );
          keyValueLog(log, {
            component: "orchestrator",
            status: statusKey,
            action: "spawn_failed_revert",
            project: project.id,
            slice: slice.id,
            reason: spawned.error,
            status_reverted: "true",
          });
        } catch (revertError) {
          keyValueLog(log, {
            component: "orchestrator",
            status: statusKey,
            action: "revert_failed",
            project: project.id,
            slice: slice.id,
            reason:
              revertError instanceof Error
                ? revertError.message
                : String(revertError),
            spawn_reason: spawned.error,
            status_reverted: "false",
          });
        }
      } else {
        keyValueLog(log, {
          component: "orchestrator",
          status: statusKey,
          action: "spawn_failed",
          project: project.id,
          slice: slice.id,
          reason: spawned.error,
        });
      }
      // Best-effort orphan cleanup: spawnSubagent may have created the slug
      // directory before failing (e.g. mkdir succeeded, git worktree add
      // failed). Without cleanup, the UI shows ghost agent rows.
      await removeOrphan(path.join(project.absolutePath, "sessions", slug));
      continue;
    }

    if (dispatchKind) attempts?.recordSuccess(slice.id, dispatchKind);

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
          reason:
            lockError instanceof Error ? lockError.message : String(lockError),
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
  await detectStalls(config, orchestratorConfig, deps);
  const results: DispatchResult[] = [];
  await reconcileLiveRuns(config, orchestratorConfig, deps);
  const globalSliceStatusIndex = await buildGlobalSliceStatusIndex(
    config,
    deps
  );
  for (const statusKey of configuredStatusKeys(orchestratorConfig)) {
    results.push(
      await dispatchForStatus(
        config,
        orchestratorConfig,
        statusKey,
        deps,
        globalSliceStatusIndex
      )
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
