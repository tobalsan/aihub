import crypto from "node:crypto";
import type {
  ScheduleJob,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  ExtensionContext,
} from "@aihub/shared";
import { PerAgentScheduleStore, type ScheduleStore } from "./store.js";
import { computeNextRunAtMs } from "./schedule.js";
import {
  formatScheduleForOutput,
  latestAssistantText,
  writeCronRunOutput,
} from "./output.js";

export type SchedulerState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error";
  lastError?: string;
};

type JobWithState = ScheduleJob & { state?: SchedulerState };

let schedulerCtx: ExtensionContext | null = null;

function uuidv7(): string {
  const bytes = crypto.randomBytes(16);
  const ts = Date.now();
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts >>> 24) & 0xff;
  bytes[3] = (ts >>> 16) & 0xff;
  bytes[4] = (ts >>> 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getSchedulerContext(): ExtensionContext {
  if (!schedulerCtx) {
    throw new Error("Scheduler context not initialized");
  }
  return schedulerCtx;
}

export function setSchedulerContext(ctx: ExtensionContext): void {
  schedulerCtx = ctx;
}

export function clearSchedulerContext(): void {
  schedulerCtx = null;
  instance = null;
}

export class SchedulerService {
  private store: ScheduleStore = { version: 1, jobs: [] };
  private jobStore: PerAgentScheduleStore;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private loaded = false;

  constructor() {
    const ctx = getSchedulerContext();
    this.jobStore = new PerAgentScheduleStore(
      ctx.getAgents(),
      (agent) => ctx.resolveWorkspaceDir(agent),
      ctx.getDataDir(),
      (message) => ctx.logger.warn(message)
    );
  }

  async start() {
    await this.load();
    const config = getSchedulerContext().getConfig();
    if (config.extensions?.scheduler?.enabled === false) {
      console.log("[scheduler] Disabled");
      return;
    }

    this.recomputeNextRuns();
    this.armTimer();
    console.log(`[scheduler] Started with ${this.store.jobs.length} job(s)`);
  }

  async stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[scheduler] Stopped");
  }

  async list(agentId?: string): Promise<ScheduleJob[]> {
    await this.load();
    return this.store.jobs.filter((job) => !agentId || job.agentId === agentId);
  }

  async add(agentId: string, input: Omit<CreateScheduleRequest, "agentId">): Promise<ScheduleJob> {
    await this.load();
    const ctx = getSchedulerContext();
    if (!ctx.getAgent(agentId)) throw new Error(`Agent not found: ${agentId}`);
    const id = crypto.randomUUID();
    const job: JobWithState = {
      id,
      name: input.name,
      agentId,
      enabled: true,
      schedule: input.schedule,
      payload: input.payload,
      createdAt: new Date().toISOString(),
      state: {},
    };

    job.state!.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
    this.store.jobs.push(job);
    await this.saveAgent(agentId);
    this.armTimer();

    return job;
  }

  async update(
    agentId: string,
    id: string,
    patch: UpdateScheduleRequest
  ): Promise<ScheduleJob> {
    await this.load();
    const job = this.findJob(agentId, id);
    if (!job) throw new Error(`Schedule not found: ${agentId}/${id}`);

    if (patch.name !== undefined) job.name = patch.name;
    if (patch.enabled !== undefined) job.enabled = patch.enabled;
    if (patch.schedule) job.schedule = patch.schedule;
    if (patch.payload) job.payload = patch.payload;

    if (job.enabled) {
      job.state = job.state ?? {};
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
    }

    await this.saveAgent(agentId);
    this.armTimer();

    return job;
  }

  async remove(agentId: string, id: string): Promise<{ removed: boolean }> {
    await this.load();
    const before = this.store.jobs.length;
    this.store.jobs = this.store.jobs.filter(
      (job) => !(job.agentId === agentId && job.id === id)
    );
    const removed = this.store.jobs.length !== before;
    if (removed) {
      await this.saveAgent(agentId);
      this.armTimer();
    }
    return { removed };
  }

  private async load() {
    if (this.loaded) return;
    this.store = await this.jobStore.load();
    this.loaded = true;
  }

  private findJob(agentId: string, id: string): JobWithState | undefined {
    return this.store.jobs.find(
      (job) => job.agentId === agentId && job.id === id
    ) as JobWithState | undefined;
  }

  private recomputeNextRuns() {
    const now = Date.now();
    for (const job of this.store.jobs as JobWithState[]) {
      if (!job.enabled) continue;
      job.state = job.state ?? {};
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, now);
    }
  }

  private async saveAgent(agentId: string) {
    await this.jobStore.saveAgentJobs(
      agentId,
      this.store.jobs.filter((job) => job.agentId === agentId)
    );
  }

  private armTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const config = getSchedulerContext().getConfig();
    if (config.extensions?.scheduler?.enabled === false) return;

    const nextAt = this.getNextWakeAt();
    if (!nextAt) return;

    const delay = Math.max(nextAt - Date.now(), 0);
    this.timer = setTimeout(() => this.tick(), delay);
    this.timer.unref?.();
  }

  private getNextWakeAt(): number | undefined {
    const enabled = (this.store.jobs as JobWithState[]).filter(
      (j) => j.enabled && j.state?.nextRunAtMs
    );
    if (enabled.length === 0) return undefined;
    return Math.min(...enabled.map((j) => j.state!.nextRunAtMs!));
  }

  private async tick() {
    if (this.running) return;
    this.running = true;

    try {
      await this.runDueJobs();
      this.armTimer();
    } finally {
      this.running = false;
    }
  }

  private async runDueJobs() {
    const now = Date.now();
    const due = (this.store.jobs as JobWithState[]).filter((j) => {
      if (!j.enabled) return false;
      return j.state?.nextRunAtMs && now >= j.state.nextRunAtMs;
    });

    for (const job of due) {
      await this.executeJob(job);
    }
  }

  private async executeJob(job: JobWithState) {
    const ctx = getSchedulerContext();
    const agent = ctx.getAgent(job.agentId);
    const firedAt = new Date();
    const sessionId = job.payload.sessionId ?? `scheduler:${job.id}:${uuidv7()}`;
    if (!agent) {
      console.error(`[scheduler] Agent not found: ${job.agentId}`);
      job.state = job.state ?? {};
      job.state.lastStatus = "error";
      job.state.lastError = "Agent not found";
      job.state.lastRunAtMs = firedAt.getTime();
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
      return;
    }

    // Skip if agent not active (single-agent mode filter)
    if (!ctx.isAgentActive(job.agentId)) {
      job.state = job.state ?? {};
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
      return;
    }

    console.log(`[scheduler] Running job: ${job.name} -> ${agent.name}`);

    try {
      const result = await ctx.runAgent({
        agentId: job.agentId,
        message: job.payload.message,
        sessionId,
        source: "scheduler",
      });

      job.state = job.state ?? {};
      job.state.lastStatus = "ok";
      job.state.lastError = undefined;
      await writeCronRunOutput({
        workspaceDir: ctx.resolveWorkspaceDir(agent),
        jobId: job.id,
        agentId: job.agentId,
        sessionId: result.meta.sessionId,
        runType: "cron",
        name: job.name,
        prompt: job.payload.message,
        schedule: formatScheduleForOutput(job.schedule),
        firedAt,
        finishedAt: new Date(),
        status: "ok",
        durationMs: Date.now() - firedAt.getTime(),
        response: latestAssistantText(result.payloads),
      });
    } catch (err) {
      job.state = job.state ?? {};
      job.state.lastStatus = "error";
      job.state.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Job failed: ${job.name}`, err);
      await writeCronRunOutput({
        workspaceDir: ctx.resolveWorkspaceDir(agent),
        jobId: job.id,
        agentId: job.agentId,
        sessionId,
        runType: "cron",
        name: job.name,
        prompt: job.payload.message,
        schedule: formatScheduleForOutput(job.schedule),
        firedAt,
        finishedAt: new Date(),
        status: "error",
        durationMs: Date.now() - firedAt.getTime(),
        error: err,
      });
    }

    job.state.lastRunAtMs = firedAt.getTime();
    job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
    await this.saveAgent(job.agentId);
  }
}

let instance: SchedulerService | null = null;

export function getScheduler(): SchedulerService {
  if (!instance) {
    instance = new SchedulerService();
  }
  return instance;
}

export async function startScheduler() {
  await getScheduler().start();
}

export async function stopScheduler() {
  await getScheduler().stop();
}
