import path from "node:path";
import type { ExtensionContext, SubagentRuntimeProfile } from "@aihub/shared";
import { notify } from "@aihub/shared";
import type { LinearClient } from "../linear/client.js";
import type { StateStore } from "../state/store.js";
import type { LinearIssue, RepoConfig, WorkflowFrontmatter } from "../types.js";
import { ClaimsRegistry } from "./claims.js";
import { ConcurrencyLimiter } from "../concurrency/limiter.js";
import { resolveRepo } from "../repo/resolver.js";
import { resolveProfile } from "../profile/resolver.js";
import { RetryPolicy } from "../retry/policy.js";
import { WorkspaceLayout, resolveWorkspacesRoot } from "../workspace/layout.js";
import { WorkflowLoader } from "../workflow/loader.js";
import { runHook } from "../hooks/runner.js";
import { createHitlBurstBuffer } from "../notifications/hitl.js";

export type OrchestratorConfig = {
  teamKey?: string;
  repos?: Record<string, string | { path: string; baseBranch?: string }>;
  defaultRepo?: string;
  poll?: { intervalMs?: number; jitterMs?: number };
  notifyChannel?: string;
  workspacesRoot?: string;
};

export type SubagentStarter = (body: Record<string, unknown>) => Promise<unknown>;
export type SubagentStatusReader = (runId: string) => Promise<unknown>;
export type OrchestratorNotifier = (message: string) => Promise<void>;

type RunMeta = {
  issue: LinearIssue;
  repo: RepoConfig | null;
  workspace: string;
  branch?: string;
  subagentRunId?: string;
  workflow: WorkflowFrontmatter;
  afterRunFired?: boolean;
};

function workflowStates(workflow?: WorkflowFrontmatter) {
  return {
    active: workflow?.tracker?.states?.active ?? ["Todo", "In Progress"],
    terminal: workflow?.tracker?.states?.terminal ?? ["Done", "Canceled"],
    needsHuman: workflow?.tracker?.states?.needs_human ?? "Needs Human",
  };
}

function reposForLoader(config: OrchestratorConfig): Record<string, RepoConfig> {
  return Object.fromEntries(
    Object.entries(config.repos ?? {}).map(([name, value]) => [
      name,
      typeof value === "string" ? { name, path: value } : { name, ...value },
    ])
  );
}

function profileList(ctx: ExtensionContext): SubagentRuntimeProfile[] {
  const raw = ctx.getConfig().extensions?.subagents;
  return raw?.profiles ?? [];
}

function promptFor(issue: LinearIssue, body: string): string {
  return `${body.trim()}\n\n## Linear issue\n${issue.identifier}: ${issue.title}\n\n${issue.description ?? ""}\n${issue.url ? `\n${issue.url}\n` : ""}`.trim();
}

function subagentTerminalStatus(status: unknown): { exitCode?: number } | undefined {
  if (!status || typeof status !== "object") return undefined;
  const record = status as Record<string, unknown>;
  const value = record.status;
  if (value !== "done" && value !== "error" && value !== "interrupted") return undefined;
  const exitCode = typeof record.exitCode === "number" ? record.exitCode : undefined;
  return { exitCode };
}

export class OrchestratorDaemon {
  private timer: NodeJS.Timeout | undefined;
  private readonly runs = new Map<string, RunMeta>();
  private readonly retry = new RetryPolicy();
  private limiter = new ConcurrencyLimiter(3);
  private tickRunning = false;
  private tickPending = false;
  private readonly hitl = createHitlBurstBuffer({ flush: async (messages) => this.flushHitl(messages) });
  lastTickAt: string | undefined;

  constructor(
    private readonly deps: {
      ctx: ExtensionContext;
      client: LinearClient;
      store: StateStore;
      claims: ClaimsRegistry;
      getConfig: () => OrchestratorConfig;
      startSubagent: SubagentStarter;
      getSubagentRun?: SubagentStatusReader;
      notify?: OrchestratorNotifier;
    }
  ) {}

  async start(): Promise<void> {
    await this.loader().ensureDefault();
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    void this.hitl.flush();
  }

  enqueueTick(): void {
    if (this.tickRunning) {
      this.tickPending = true;
      return;
    }
    void this.runQueuedTick();
  }

  private async runQueuedTick(): Promise<void> {
    this.tickRunning = true;
    try {
      do {
        this.tickPending = false;
        await this.tick();
      } while (this.tickPending);
    } finally {
      this.tickRunning = false;
    }
  }

  private loader(): WorkflowLoader {
    return new WorkflowLoader(this.deps.ctx.getDataDir(), reposForLoader(this.deps.getConfig()));
  }

  private workspacesRoot(): string {
    return resolveWorkspacesRoot({ configured: this.deps.getConfig().workspacesRoot, dataDir: this.deps.ctx.getDataDir() });
  }

  private schedule(): void {
    const cfg = this.deps.getConfig();
    const delay = cfg.poll?.intervalMs ?? 30_000;
    const jitter = cfg.poll?.jitterMs ?? 5_000;
    const next = Math.max(1_000, delay + Math.floor((Math.random() * 2 - 1) * jitter));
    this.timer = setTimeout(() => void this.tick().finally(() => this.schedule()), next);
  }

  async claimNow(idOrIdentifier: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const existing = this.deps.claims.get(idOrIdentifier);
    if (existing) return { ok: false, status: 409, error: "issue already claimed" };
    const issue = await this.deps.client.getIssue(idOrIdentifier);
    if (!issue) return { ok: false, status: 404, error: "issue not found" };
    if (this.deps.claims.get(issue.id)) return { ok: false, status: 409, error: "issue already claimed" };
    const dispatched = await this.dispatch(issue);
    if (!dispatched && this.deps.claims.get(issue.id)) {
      return { ok: false, status: 409, error: "issue already claimed" };
    }
    return dispatched
      ? { ok: true }
      : { ok: false, status: 409, error: "issue was not dispatched" };
  }

  async tick(): Promise<{ dispatched: number; skipped: number; released: number }> {
    this.lastTickAt = new Date().toISOString();
    this.deps.store.heartbeat();
    await this.observeSubagentCompletions();
    await this.detectStalls();

    const fallback = await this.loader().resolve();
    const states = workflowStates(fallback.frontmatter);
    const cfg = this.deps.getConfig();
    if (!cfg.teamKey) return { dispatched: 0, skipped: 0, released: 0 };

    const issues = await this.deps.client.pollIssues({
      teamKey: cfg.teamKey,
      activeStates: [...new Set([...states.active, ...states.terminal, states.needsHuman])],
    });

    let dispatched = 0;
    let skipped = 0;
    let released = 0;
    const max = fallback.frontmatter.agent?.max_concurrent ?? 3;
    this.limiter = new ConcurrencyLimiter(max);
    for (const claim of this.deps.claims.list()) this.limiter.tryReserve({ issueId: claim.issueId });

    for (const issue of issues) {
      const claim = this.deps.claims.get(issue.id);
      if (claim && states.terminal.includes(issue.state)) {
        await this.release(issue.id, "terminal");
        released += 1;
        continue;
      }
      if (!states.active.includes(issue.state) || claim) {
        skipped += 1;
        continue;
      }
      const next = this.retry.nextAttempt(issue.id, "dispatch");
      if (next && next > Date.now()) {
        skipped += 1;
        continue;
      }
      const ok = await this.dispatch(issue);
      if (ok) dispatched += 1;
      else skipped += 1;
    }
    return { dispatched, skipped, released };
  }

  private async dispatch(issue: LinearIssue): Promise<boolean> {
    const cfg = this.deps.getConfig();
    const repoResolution = resolveRepo({ labels: issue.labels, repos: cfg.repos, defaultRepo: cfg.defaultRepo });
    const workflow = await this.loader().resolve({ repo: repoResolution.repo?.name, issue });
    const states = workflowStates(workflow.frontmatter);
    if (repoResolution.warning) this.deps.ctx.emit("orchestrator.run.event", { issueId: issue.id, type: "warning", message: repoResolution.warning });

    const profile = resolveProfile({ workflow: workflow.frontmatter, profilesConfig: profileList(this.deps.ctx) });
    if ("park" in profile) {
      await this.park(issue, states.needsHuman, profile.park.reason);
      return false;
    }

    const reservation = this.limiter.tryReserve({ issueId: issue.id, profile: profile.profile.name, repo: repoResolution.repo?.name });
    if (!reservation.ok) return false;

    const runId = `orchestrator:${issue.id}:${Date.now()}`;
    const claim = await this.deps.claims.tryClaim(issue.id, runId);
    if (!claim) {
      reservation.release();
      return false;
    }

    try {
      const layout = new WorkspaceLayout(this.workspacesRoot());
      const workspace = await layout.create({ identifier: issue.identifier, repo: repoResolution.repo });
      const env = this.hookEnv(issue, workspace.path, repoResolution.repo, workspace.branch);
      this.deps.store.claim(issue.id, runId);
      this.deps.store.insertRun({
        runId,
        issueId: issue.id,
        identifier: issue.identifier,
        workspace: workspace.path,
        repo: repoResolution.repo?.name ?? null,
        branch: workspace.branch ?? null,
        profileJson: JSON.stringify(profile.profile),
        workflowPath: workflow.path,
        workflowSha: workflow.sha,
        pid: null,
        startedAt: new Date().toISOString(),
      });
      this.deps.store.appendEvent(runId, "run.claimed", { issueId: issue.id, identifier: issue.identifier });
      this.deps.ctx.emit("orchestrator.run.claimed", claim);

      if (workspace.created) {
        await runHook({ command: workflow.frontmatter.hooks?.after_create, phase: "after_create", cwd: workspace.path, runId, store: this.deps.store, env }).catch((error) => {
          this.deps.store.appendEvent(runId, "hook.after_create.error", { error: error instanceof Error ? error.message : String(error) });
        });
      }

      const before = await runHook({ command: workflow.frontmatter.hooks?.before_run, phase: "before_run", cwd: workspace.path, runId, store: this.deps.store, env });
      if (before !== 0) {
        this.deps.store.finishRun(runId, "hook_failed", before);
        await this.release(issue.id, "hook_failed");
        return false;
      }

      const subagent = await this.deps.startSubagent({
        profile: profile.profile.name,
        cli: profile.profile.cli,
        cwd: workspace.path,
        prompt: promptFor(issue, workflow.body),
        label: profile.profile.labelPrefix ?? issue.identifier,
        parent: { type: "orchestrator", id: issue.id },
        source: "orchestrator",
        model: profile.profile.model,
        reasoningEffort: profile.profile.reasoningEffort ?? profile.profile.reasoning,
      });
      const subagentRunId = typeof subagent === "object" && subagent && "id" in subagent ? String((subagent as { id: unknown }).id) : undefined;
      this.runs.set(issue.id, { issue, repo: repoResolution.repo, workspace: workspace.path, branch: workspace.branch, subagentRunId, workflow: workflow.frontmatter });
      this.deps.store.setSubagentRunId(runId, subagentRunId);
      this.deps.store.appendEvent(runId, "subagent.started", subagent);
      this.deps.claims.touch(issue.id);
      this.retry.reset(issue.id, "dispatch");
      return true;
    } catch (error) {
      reservation.release();
      this.retry.register(issue.id, "dispatch");
      this.deps.store.appendEvent(runId, "dispatch.error", { error: error instanceof Error ? error.message : String(error) });
      this.deps.store.finishRun(runId, "dispatch_failed");
      await this.release(issue.id, "dispatch_failed");
      return false;
    }
  }

  private hookEnv(issue: LinearIssue, workspace: string, repo: RepoConfig | null, branch?: string): Record<string, string | undefined> {
    return {
      AIHUB_ISSUE_ID: issue.id,
      AIHUB_ISSUE_IDENTIFIER: issue.identifier,
      AIHUB_WORKSPACE: workspace,
      AIHUB_REPO: repo?.name,
      AIHUB_BRANCH: branch,
      LINEAR_API_KEY: undefined,
    };
  }

  private async park(issue: LinearIssue, needsHuman: string, reason: string): Promise<void> {
    await this.deps.client.commentCreate(issue.id, `Orchestrator parked issue: ${reason}`).catch(() => undefined);
    await this.deps.client.issueUpdateStateByName(issue.id, needsHuman).catch(() => undefined);
    this.deps.ctx.emit("orchestrator.run.needs_human", { issueId: issue.id, reason });
    this.notifyHitl(`Orchestrator needs human for ${issue.identifier}: ${reason}`);
  }

  private async observeSubagentCompletions(): Promise<void> {
    if (!this.deps.getSubagentRun) return;
    for (const [issueId, run] of this.runs) {
      if (!run.subagentRunId || run.afterRunFired) continue;
      const status = await this.deps.getSubagentRun(run.subagentRunId).catch(() => undefined);
      const terminal = subagentTerminalStatus(status);
      if (!terminal) continue;
      run.afterRunFired = true;
      const claim = this.deps.claims.get(issueId);
      if (!claim) continue;
      await runHook({ command: run.workflow.hooks?.after_run, phase: "after_run", cwd: run.workspace, runId: claim.runId, store: this.deps.store, env: this.hookEnv(run.issue, run.workspace, run.repo, run.branch), exitCode: terminal.exitCode }).catch((error) => {
        this.deps.store.appendEvent(claim.runId, "hook.after_run.error", { error: error instanceof Error ? error.message : String(error) });
      });
    }
  }

  private async detectStalls(): Promise<void> {
    const fallback = await this.loader().resolve();
    const timeout = fallback.frontmatter.agent?.stall_timeout_ms ?? 1_800_000;
    const states = workflowStates(fallback.frontmatter);
    const now = Date.now();
    for (const claim of this.deps.claims.list()) {
      if (now - Date.parse(claim.lastEventAt) <= timeout) continue;
      await this.deps.client.commentCreate(claim.issueId, `Orchestrator stalled: no events for ${timeout}ms`).catch(() => undefined);
      await this.deps.client.issueUpdateStateByName(claim.issueId, states.needsHuman).catch(() => undefined);
      await this.interruptSubagent(claim.issueId);
      this.deps.ctx.emit("orchestrator.run.stalled", { issueId: claim.issueId, runId: claim.runId });
      this.notifyHitl(`Orchestrator stalled: ${claim.issueId}`);
      await this.release(claim.issueId, "stalled");
    }
  }

  async interruptSubagent(issueId: string): Promise<void> {
    const run = this.runs.get(issueId);
    if (!run?.subagentRunId) return;
    const url = process.env.AIHUB_API_URL ?? process.env.AIHUB_URL ?? "http://127.0.0.1:4000/api";
    await fetch(`${url.replace(/\/$/, "")}/subagents/${encodeURIComponent(run.subagentRunId)}/interrupt`, { method: "POST" }).catch(() => undefined);
  }

  private async release(issueId: string, outcome: string): Promise<void> {
    const claim = this.deps.claims.get(issueId);
    if (!claim) return;
    const run = this.runs.get(issueId);
    if (run && !run.afterRunFired) {
      run.afterRunFired = true;
      await runHook({ command: run.workflow.hooks?.after_run, phase: "after_run", cwd: run.workspace, runId: claim.runId, store: this.deps.store, env: this.hookEnv(run.issue, run.workspace, run.repo, run.branch) }).catch((error) => {
        this.deps.store.appendEvent(claim.runId, "hook.after_run.error", { error: error instanceof Error ? error.message : String(error) });
      });
    }
    if (run?.workflow.workspace?.cleanup_on_terminal) {
      await this.removeWorkspace(run, claim.runId);
    }
    this.deps.claims.release(issueId);
    this.deps.store.release(issueId);
    this.deps.store.finishRun(claim.runId, outcome);
    this.deps.ctx.emit("orchestrator.run.finished", { issueId, runId: claim.runId, outcome });
  }

  private async removeWorkspace(run: RunMeta, runId: string): Promise<void> {
    await runHook({ command: run.workflow.hooks?.before_remove, phase: "before_remove", cwd: run.workspace, runId, store: this.deps.store, env: this.hookEnv(run.issue, run.workspace, run.repo, run.branch) }).catch((error) => {
      this.deps.store.appendEvent(runId, "hook.before_remove.error", { error: error instanceof Error ? error.message : String(error) });
    });
    await new WorkspaceLayout(this.workspacesRoot()).remove({ identifier: run.issue.identifier, repo: run.repo });
  }

  notifyStartupError(error: unknown): void {
    this.notifyHitl(`Orchestrator startup error: ${error instanceof Error ? error.message : String(error)}`);
  }

  notifyRunFailed(issueId: string, reason: string): void {
    this.notifyHitl(`Orchestrator run failed for ${issueId}: ${reason}`);
  }

  private notifyHitl(message: string): void {
    this.hitl.push(message);
  }

  private async flushHitl(messages: string[]): Promise<void> {
    const channel = await this.notifyChannel();
    if (!channel) return;
    const message = messages.length === 1 ? messages[0] : messages.map((item) => `- ${item}`).join("\n");
    const send = this.deps.notify ?? (async (text: string) => {
      await notify({ config: this.deps.ctx.getConfig().notifications, channel, message: text });
    });
    await send(message).catch((error) => {
      this.deps.ctx.emit("orchestrator.run.event", { type: "notification.error", message: error instanceof Error ? error.message : String(error) });
    });
  }

  private async notifyChannel(): Promise<string | undefined> {
    const configured = this.deps.getConfig().notifyChannel;
    if (configured) return configured;
    const workflow = await this.loader().resolve().catch(() => undefined);
    return workflow?.frontmatter.server?.notify_channel;
  }
}
