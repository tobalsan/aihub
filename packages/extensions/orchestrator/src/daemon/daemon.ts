import type { ExtensionContext, SubagentRuntimeProfile } from "@aihub/shared";
import { notify } from "@aihub/shared";
import type { LinearClient } from "../linear/client.js";
import type { StateStore } from "../state/store.js";
import type { LinearIssue, ProjectDescriptor, WorkflowSnapshot } from "../types.js";
import { ClaimsRegistry } from "./claims.js";
import { ConcurrencyLimiter } from "../concurrency/limiter.js";
import { resolveProfile } from "../profile/resolver.js";
import { RetryPolicy } from "../retry/policy.js";
import { WorkspaceLayout } from "../workspace/layout.js";
import { WorkflowLoader } from "../workflow/loader.js";
import { runHook } from "../hooks/runner.js";
import { createHitlBurstBuffer } from "../notifications/hitl.js";
import { resolveProjects } from "../projects/registry.js";

export type OrchestratorConfig = {
  projects?: string[];
  concurrency?: { global?: number };
  validation?: { strict?: boolean };
  notifyChannel?: string;
};

export type SubagentStarter = (body: Record<string, unknown>) => Promise<unknown>;
export type SubagentStatusReader = (runId: string) => Promise<unknown>;
export type OrchestratorNotifier = (message: string) => Promise<void>;
export type LinearClientFactory = (input: { apiKey: string; endpoint: string; project: ProjectDescriptor }) => LinearClient;

type RunMeta = {
  project: ProjectDescriptor;
  issue: LinearIssue;
  workspace: string;
  subagentRunId?: string;
  workflow: WorkflowSnapshot;
  afterRunFired?: boolean;
};

function profileList(ctx: ExtensionContext): SubagentRuntimeProfile[] {
  const raw = ctx.getConfig().extensions?.subagents;
  return raw?.profiles ?? [];
}

function promptFor(project: ProjectDescriptor, issue: LinearIssue, body: string): string {
  return `${body.trim()}\n\n## Orchestrator context\nProject: ${project.id}\nLinear GraphQL tool calls must pass project: ${project.id}\n\n## Linear issue\n${issue.identifier}: ${issue.title}\n\n${issue.description ?? ""}\n${issue.url ? `\n${issue.url}\n` : ""}`.trim();
}

function subagentTerminalStatus(status: unknown): { status: "done" | "error" | "interrupted"; exitCode?: number } | undefined {
  if (!status || typeof status !== "object") return undefined;
  const record = status as Record<string, unknown>;
  const value = record.status;
  if (value !== "done" && value !== "error" && value !== "interrupted") return undefined;
  return { status: value, exitCode: typeof record.exitCode === "number" ? record.exitCode : undefined };
}

export class OrchestratorDaemon {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly runs = new Map<string, RunMeta>();
  private readonly retry = new RetryPolicy();
  private tickRunning = false;
  private tickPending = false;
  private readonly pendingProjectTicks = new Set<string | undefined>();
  private readonly hitl = createHitlBurstBuffer({ flush: async (messages) => this.flushHitl(messages) });
  private projects: ProjectDescriptor[] = [];
  private watchers: Array<{ close: () => void }> = [];
  private readonly workflowLoader: WorkflowLoader;
  lastTickAt: string | undefined;
  rateLimitRemaining: number | undefined;

  constructor(
    private readonly deps: {
      ctx: ExtensionContext;
      client?: LinearClient;
      store: StateStore;
      claims: ClaimsRegistry;
      getConfig: () => OrchestratorConfig;
      startSubagent: SubagentStarter;
      getSubagentRun?: SubagentStatusReader;
      createLinearClient?: LinearClientFactory;
      stopSubagent?: (runId: string) => Promise<unknown>;
      notify?: OrchestratorNotifier;
      workflowLoader?: WorkflowLoader;
    }
  ) {
    this.workflowLoader = this.deps.workflowLoader ?? new WorkflowLoader(this.deps.ctx.getDataDir());
  }

  async start(): Promise<void> {
    this.projects = await resolveProjects({ paths: this.deps.getConfig().projects ?? [], dataDir: this.deps.ctx.getDataDir() });
    await this.validateProjectSlugs();
    await this.stopStaleOwnedWorkers();
    this.deps.store.markOpenRunsInterrupted("interrupted_gateway_restart");
    const loader = this.loader();
    this.watchers = this.projects.map((project) => loader.watch(project.path, (event) => this.deps.ctx.emit("orchestrator.workflow.changed", { project: project.id, ...event })));
    for (const project of this.projects) await this.scheduleProject(project);
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const run of this.runs.values()) if (run.subagentRunId) await this.deps.stopSubagent?.(run.subagentRunId).catch(() => undefined);
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    this.deps.store.markActiveProcessStopped();
    await this.hitl.flush();
  }

  enqueueTick(projectId?: string): void {
    this.pendingProjectTicks.add(projectId);
    if (this.tickRunning) { this.tickPending = true; return; }
    void this.runQueuedTick();
  }

  private async runQueuedTick(): Promise<void> {
    this.tickRunning = true;
    try {
      do {
        this.tickPending = false;
        const projectIds = [...this.pendingProjectTicks];
        this.pendingProjectTicks.clear();
        if (projectIds.includes(undefined)) await this.tick();
        else for (const projectId of projectIds) await this.tick(projectId);
      } while (this.tickPending || this.pendingProjectTicks.size > 0);
    } finally { this.tickRunning = false; }
  }

  private loader(): WorkflowLoader { return this.workflowLoader; }

  private async validateProjectSlugs(): Promise<void> {
    const seen = new Map<string, string>();
    for (const project of this.projects) {
      const workflow = await this.loader().loadProjectWorkflow({ projectPath: project.path });
      const existing = seen.get(workflow.config.tracker.projectSlug);
      if (existing) throw new Error(`duplicate tracker.project_slug ${workflow.config.tracker.projectSlug}: ${existing}, ${project.id}`);
      seen.set(workflow.config.tracker.projectSlug, project.id);
    }
  }

  private async stopStaleOwnedWorkers(): Promise<void> {
    for (const row of this.deps.store.listOpenRuns()) {
      const subagentRunId = typeof row.subagent_run_id === "string" ? row.subagent_run_id : undefined;
      if (subagentRunId) await this.deps.stopSubagent?.(subagentRunId).catch(() => undefined);
      const pid = typeof row.pid === "number" ? row.pid : undefined;
      if (pid && pid > 0 && pid !== process.pid) {
        try { process.kill(pid, "SIGTERM"); } catch {}
      }
    }
  }

  private async scheduleProject(project: ProjectDescriptor): Promise<void> {
    const workflow = await this.loader().loadProjectWorkflow({ projectPath: project.path, allowStale: true });
    const delay = workflow.config.polling.intervalMs;
    const jitter = workflow.config.polling.jitterMs;
    const next = Math.max(1_000, delay + Math.floor((Math.random() * 2 - 1) * jitter));
    const previous = this.timers.get(project.id);
    if (previous) clearTimeout(previous);
    this.timers.set(project.id, setTimeout(() => { this.enqueueTick(project.id); void this.scheduleProject(project); }, next));
  }

  async claimNow(idOrIdentifier: string, projectId?: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const targets = projectId ? this.projects.filter((project) => project.id === projectId || project.path === projectId) : this.projects;
    for (const project of targets) {
      const workflow = await this.loader().loadProjectWorkflow({ projectPath: project.path, allowStale: true });
      const client = this.clientFor(project, workflow);
      const issue = await client.getIssue(idOrIdentifier).catch(() => undefined);
      if (!issue) continue;
      if (issue.projectSlug && issue.projectSlug !== workflow.config.tracker.projectSlug) continue;
      if (this.deps.claims.get(issue.id, project.id)) return { ok: false, status: 409, error: "issue already claimed" };
      return (await this.dispatch(project, workflow, issue, client)) ? { ok: true } : { ok: false, status: 409, error: "issue was not dispatched" };
    }
    return { ok: false, status: 404, error: "issue not found" };
  }

  async tick(projectId?: string): Promise<{ dispatched: number; skipped: number; released: number }> {
    this.lastTickAt = new Date().toISOString();
    this.deps.store.heartbeat();
    await this.detectStalls();

    let dispatched = 0;
    let skipped = 0;
    let released = 0;
    const completedThisTick = await this.observeSubagentCompletions();
    const projects = projectId ? this.projects.filter((project) => project.id === projectId || project.path === projectId) : this.projects;
    const globalLimiter = new ConcurrencyLimiter(this.deps.getConfig().concurrency?.global ?? 3);
    for (const claim of this.deps.claims.list()) globalLimiter.tryReserve({ issueId: claim.issueId });

    for (const project of projects) {
      const workflow = await this.loader().loadProjectWorkflow({ projectPath: project.path, allowStale: true });
      const client = this.clientFor(project, workflow);
      const states = workflow.config.tracker;
      const issues = await client.pollIssues({ projectSlug: states.projectSlug, activeStates: [...new Set([...states.activeStates, ...states.terminalStates, states.needsHuman])] });
      this.updateRateLimit(client.rateLimitRemaining);
      const projectLimiter = new ConcurrencyLimiter(workflow.config.agent.max_concurrent ?? 3);
      for (const claim of this.deps.claims.list({ projectId: project.id })) projectLimiter.tryReserve({ issueId: claim.issueId });

      for (const issue of issues) {
        const claim = this.deps.claims.get(issue.id, project.id);
        if (claim && issue.state === states.needsHuman) { await this.release(project.id, issue.id, "needs_human"); released += 1; continue; }
        if (claim && states.terminalStates.includes(issue.state)) { await this.release(project.id, issue.id, "terminal"); released += 1; continue; }
        if (completedThisTick.has(`${project.id}:${issue.id}`) || !states.activeStates.includes(issue.state) || claim) { skipped += 1; continue; }
        const next = this.retry.nextAttempt(`${project.id}:${issue.id}`, "dispatch");
        if (next && next > Date.now()) { skipped += 1; continue; }
        const global = globalLimiter.tryReserve({ issueId: issue.id });
        const local = projectLimiter.tryReserve({ issueId: issue.id });
        if (!global.ok || !local.ok) { if (global.ok) global.release(); if (local.ok) local.release(); skipped += 1; continue; }
        const ok = await this.dispatch(project, workflow, issue, client);
        if (ok) dispatched += 1; else { global.release(); local.release(); skipped += 1; }
      }
    }
    return { dispatched, skipped, released };
  }

  private clientFor(project: ProjectDescriptor, workflow: WorkflowSnapshot): LinearClient {
    return this.deps.createLinearClient?.({ apiKey: workflow.config.tracker.apiKey, endpoint: workflow.config.tracker.endpoint, project }) ?? this.deps.client!;
  }

  private updateRateLimit(remaining: number | undefined): void {
    if (remaining === undefined || Number.isNaN(remaining)) return;
    this.rateLimitRemaining = this.rateLimitRemaining === undefined ? remaining : Math.min(this.rateLimitRemaining, remaining);
  }

  private async dispatch(project: ProjectDescriptor, workflow: WorkflowSnapshot, issue: LinearIssue, client: LinearClient): Promise<boolean> {
    if (this.deps.claims.get(issue.id)) return false;
    const previousRuns = this.deps.store.countRunsByIssue(issue.id, project.id);
    const attempt = previousRuns === 0 ? null : previousRuns + 1;
    const resolvedWorkflow = await this.loader().loadProjectWorkflow({ projectPath: project.path, issue, attempt, allowStale: true });
    const profile = resolveProfile({ workflow: resolvedWorkflow.frontmatter, profilesConfig: profileList(this.deps.ctx) });
    if ("park" in profile) { await this.park(client, issue, resolvedWorkflow.config.tracker.needsHuman, profile.park.reason); return false; }
    const runId = `orchestrator:${project.id}:${issue.id}:${Date.now()}`;
    const label = `${issue.identifier}-${runId.split(":").at(-1)}`;
    const claim = await this.deps.claims.tryClaim(issue.id, runId, project.id);
    if (!claim) return false;
    try {
      const workspace = await new WorkspaceLayout(resolvedWorkflow.config.workspace.root).create({ identifier: issue.identifier });
      const env = this.hookEnv(issue, workspace.path, project.id);
      this.deps.store.claim(issue.id, runId, project.id);
      this.deps.store.insertRun({ runId, projectId: project.id, issueId: issue.id, identifier: issue.identifier, workspace: workspace.path, profileJson: JSON.stringify(profile.profile), workflowPath: resolvedWorkflow.path, workflowSha: resolvedWorkflow.sha, pid: null, startedAt: new Date().toISOString() });
      this.deps.store.appendEvent(runId, "run.claimed", { issueId: issue.id, identifier: issue.identifier, projectId: project.id }, project.id);
      this.deps.ctx.emit("orchestrator.run.claimed", claim);
      if (workspace.created) await runHook({ command: resolvedWorkflow.config.hooks?.after_create, phase: "after_create", cwd: workspace.path, runId, store: this.deps.store, env }).catch((error) => this.deps.store.appendEvent(runId, "hook.after_create.error", { error: error instanceof Error ? error.message : String(error) }, project.id));
      const before = await runHook({ command: resolvedWorkflow.config.hooks?.before_run, phase: "before_run", cwd: workspace.path, runId, store: this.deps.store, env });
      if (before !== 0) { this.deps.store.finishRun(runId, "hook_failed", before); await this.release(project.id, issue.id, "hook_failed"); return false; }
      const subagent = await this.deps.startSubagent({ profile: profile.profile.name, cli: profile.profile.cli, cwd: workspace.path, prompt: promptFor(project, issue, resolvedWorkflow.body), label: profile.profile.labelPrefix ? `${profile.profile.labelPrefix}-${label}` : label, parent: { type: "orchestrator", id: `${project.id}:${issue.id}` }, source: "orchestrator", model: profile.profile.model, reasoningEffort: profile.profile.reasoningEffort ?? profile.profile.reasoning });
      const subagentRunId = typeof subagent === "object" && subagent && "id" in subagent ? String((subagent as { id: unknown }).id) : undefined;
      this.runs.set(`${project.id}:${issue.id}`, { project, issue, workspace: workspace.path, subagentRunId, workflow: resolvedWorkflow });
      this.deps.store.setSubagentRunId(runId, subagentRunId);
      this.deps.store.appendEvent(runId, "subagent.started", subagent, project.id);
      this.deps.claims.touch(issue.id, undefined, project.id);
      this.retry.reset(`${project.id}:${issue.id}`, "dispatch");
      return true;
    } catch (error) {
      this.retry.register(`${project.id}:${issue.id}`, "dispatch");
      this.deps.store.appendEvent(runId, "dispatch.error", { error: error instanceof Error ? error.message : String(error) }, project.id);
      this.deps.store.finishRun(runId, "dispatch_failed");
      await this.release(project.id, issue.id, "dispatch_failed");
      return false;
    }
  }

  private hookEnv(issue: LinearIssue, workspace: string, projectId: string): Record<string, string | undefined> {
    return { AIHUB_PROJECT_ID: projectId, AIHUB_ISSUE_ID: issue.id, AIHUB_ISSUE_IDENTIFIER: issue.identifier, AIHUB_WORKSPACE: workspace, LINEAR_API_KEY: undefined };
  }

  private async park(client: LinearClient, issue: LinearIssue, needsHuman: string, reason: string, options: { subagentRunId?: string } = {}): Promise<void> {
    await client.commentCreate(issue.id, `Orchestrator parked issue: ${reason}`).catch(() => undefined);
    await client.issueUpdateStateByName(issue.id, needsHuman).catch(() => undefined);
    if (options.subagentRunId) await this.deps.stopSubagent?.(options.subagentRunId).catch(() => undefined);
    this.deps.ctx.emit("orchestrator.run.needs_human", { issueId: issue.id, reason });
    this.notifyHitl(`Orchestrator needs human for ${issue.identifier}: ${reason}`);
  }

  private async observeSubagentCompletions(): Promise<Set<string>> {
    const completed = new Set<string>();
    if (!this.deps.getSubagentRun) return completed;
    for (const [key, run] of this.runs) {
      if (!run.subagentRunId || run.afterRunFired) continue;
      const terminal = subagentTerminalStatus(await this.deps.getSubagentRun(run.subagentRunId).catch(() => undefined));
      if (!terminal) continue;
      run.afterRunFired = true;
      const claim = this.deps.claims.get(run.issue.id, run.project.id);
      if (!claim) continue;
      await runHook({ command: run.workflow.config.hooks?.after_run, phase: "after_run", cwd: run.workspace, runId: claim.runId, store: this.deps.store, env: this.hookEnv(run.issue, run.workspace, run.project.id), exitCode: terminal.exitCode }).catch((error) => this.deps.store.appendEvent(claim.runId, "hook.after_run.error", { error: error instanceof Error ? error.message : String(error) }, run.project.id));
      this.runs.set(key, run);
      if (terminal.status === "error") {
        await this.park(this.clientFor(run.project, run.workflow), run.issue, run.workflow.config.tracker.needsHuman, `worker exited with error${terminal.exitCode === undefined ? "" : ` (exit ${terminal.exitCode})`}`, { subagentRunId: run.subagentRunId });
      }
      await this.release(run.project.id, run.issue.id, terminal.status === "done" ? "completed" : terminal.status);
      completed.add(key);
    }
    return completed;
  }

  private async detectStalls(): Promise<void> {
    const now = Date.now();
    for (const claim of this.deps.claims.list()) {
      const run = this.runs.get(`${claim.projectId}:${claim.issueId}`);
      const timeout = run?.workflow.config.agent.stall_timeout_ms ?? 1_800_000;
      if (now - Date.parse(claim.lastEventAt) <= timeout || !run) continue;
      const client = this.clientFor(run.project, run.workflow);
      await client.commentCreate(claim.issueId, `Orchestrator stalled: no events for ${timeout}ms`).catch(() => undefined);
      await client.issueUpdateStateByName(claim.issueId, run.workflow.config.tracker.needsHuman).catch(() => undefined);
      if (run.subagentRunId) await this.deps.stopSubagent?.(run.subagentRunId).catch(() => undefined);
      this.notifyHitl(`Orchestrator stalled: ${claim.issueId}`);
      await this.release(claim.projectId, claim.issueId, "stalled");
    }
  }

  async interruptSubagent(issueId: string, projectId = "default"): Promise<void> {
    const run = this.runs.get(`${projectId}:${issueId}`) ?? [...this.runs.values()].find((item) => item.issue.id === issueId);
    if (run?.subagentRunId) await this.deps.stopSubagent?.(run.subagentRunId).catch(() => undefined);
  }

  private async release(projectId: string, issueId: string, outcome: string): Promise<void> {
    const claim = this.deps.claims.get(issueId, projectId);
    if (!claim) return;
    const run = this.runs.get(`${projectId}:${issueId}`);
    if ((outcome === "terminal" || outcome === "needs_human") && run?.subagentRunId) await this.deps.stopSubagent?.(run.subagentRunId).catch(() => undefined);
    if (run && !run.afterRunFired) {
      run.afterRunFired = true;
      await runHook({ command: run.workflow.config.hooks?.after_run, phase: "after_run", cwd: run.workspace, runId: claim.runId, store: this.deps.store, env: this.hookEnv(run.issue, run.workspace, projectId) }).catch((error) => this.deps.store.appendEvent(claim.runId, "hook.after_run.error", { error: error instanceof Error ? error.message : String(error) }, projectId));
    }
    if (run?.workflow.config.workspace.cleanupOnTerminal) await this.removeWorkspace(run, claim.runId);
    this.deps.claims.release(issueId, projectId);
    this.deps.store.release(issueId, projectId);
    this.deps.store.finishRun(claim.runId, outcome);
    this.runs.delete(`${projectId}:${issueId}`);
    this.deps.ctx.emit("orchestrator.run.finished", { issueId, projectId, runId: claim.runId, outcome });
  }

  private async removeWorkspace(run: RunMeta, runId: string): Promise<void> {
    await runHook({ command: run.workflow.config.hooks?.before_remove, phase: "before_remove", cwd: run.workspace, runId, store: this.deps.store, env: this.hookEnv(run.issue, run.workspace, run.project.id) }).catch((error) => this.deps.store.appendEvent(runId, "hook.before_remove.error", { error: error instanceof Error ? error.message : String(error) }, run.project.id));
    await new WorkspaceLayout(run.workflow.config.workspace.root).remove({ identifier: run.issue.identifier });
  }

  notifyStartupError(error: unknown): void { this.notifyHitl(`Orchestrator startup error: ${error instanceof Error ? error.message : String(error)}`); }
  notifyRunFailed(issueId: string, reason: string): void { this.notifyHitl(`Orchestrator run failed for ${issueId}: ${reason}`); }
  private notifyHitl(message: string): void { this.hitl.push(message); }

  private async flushHitl(messages: string[]): Promise<void> {
    const configured = this.deps.getConfig().notifyChannel;
    if (!configured) return;
    const message = messages.length === 1 ? messages[0] : messages.map((item) => `- ${item}`).join("\n");
    const send = this.deps.notify ?? (async (text: string) => { await notify({ config: this.deps.ctx.getConfig().notifications, channel: configured, message: text }); });
    await send(message).catch((error) => this.deps.ctx.emit("orchestrator.run.event", { type: "notification.error", message: error instanceof Error ? error.message : String(error) }));
  }
}
