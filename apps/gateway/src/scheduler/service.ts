import crypto from "node:crypto";
import type { ScheduleJob, CreateScheduleRequest, UpdateScheduleRequest } from "@aihub/shared";
import { loadConfig, getAgent, isAgentActive } from "../config/index.js";
import { runAgent } from "../agents/index.js";
import { loadScheduleStore, saveScheduleStore, type ScheduleStore } from "./store.js";
import { computeNextRunAtMs } from "./schedule.js";

export type SchedulerState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error";
  lastError?: string;
};

type JobWithState = ScheduleJob & { state?: SchedulerState };

export class SchedulerService {
  private store: ScheduleStore;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickMs: number;

  constructor() {
    this.store = loadScheduleStore();
    const config = loadConfig();
    this.tickMs = (config.scheduler?.tickSeconds ?? 60) * 1000;
  }

  async start() {
    const config = loadConfig();
    if (config.scheduler?.enabled === false) {
      console.log("[scheduler] Disabled");
      return;
    }

    this.recomputeNextRuns();
    this.save();
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

  async list(): Promise<ScheduleJob[]> {
    return this.store.jobs.filter((j) => j.enabled);
  }

  async add(input: CreateScheduleRequest): Promise<ScheduleJob> {
    const id = crypto.randomUUID();
    const job: JobWithState = {
      id,
      name: input.name,
      agentId: input.agentId,
      enabled: true,
      schedule: input.schedule,
      payload: input.payload,
      state: {},
    };

    job.state!.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
    this.store.jobs.push(job);
    this.save();
    this.armTimer();

    return job;
  }

  async update(id: string, patch: UpdateScheduleRequest): Promise<ScheduleJob> {
    const job = this.store.jobs.find((j) => j.id === id) as JobWithState | undefined;
    if (!job) throw new Error(`Schedule not found: ${id}`);

    if (patch.name !== undefined) job.name = patch.name;
    if (patch.enabled !== undefined) job.enabled = patch.enabled;
    if (patch.schedule) job.schedule = patch.schedule;
    if (patch.payload) job.payload = patch.payload;

    if (job.enabled) {
      job.state = job.state ?? {};
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
    }

    this.save();
    this.armTimer();

    return job;
  }

  async remove(id: string): Promise<{ removed: boolean }> {
    const before = this.store.jobs.length;
    this.store.jobs = this.store.jobs.filter((j) => j.id !== id);
    const removed = this.store.jobs.length !== before;
    if (removed) {
      this.save();
      this.armTimer();
    }
    return { removed };
  }

  private recomputeNextRuns() {
    const now = Date.now();
    for (const job of this.store.jobs as JobWithState[]) {
      if (!job.enabled) continue;
      job.state = job.state ?? {};
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, now);
    }
  }

  private save() {
    saveScheduleStore(this.store);
  }

  private armTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

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
      this.save();
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
    const agent = getAgent(job.agentId);
    if (!agent) {
      console.error(`[scheduler] Agent not found: ${job.agentId}`);
      job.state = job.state ?? {};
      job.state.lastStatus = "error";
      job.state.lastError = "Agent not found";
      job.state.lastRunAtMs = Date.now();
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
      return;
    }

    // Skip if agent is not active (single-agent mode filter)
    if (!isAgentActive(job.agentId)) {
      job.state = job.state ?? {};
      job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
      return;
    }

    console.log(`[scheduler] Running job: ${job.name} -> ${agent.name}`);
    const startedAt = Date.now();

    try {
      await runAgent({
        agentId: job.agentId,
        message: job.payload.message,
        sessionId: job.payload.sessionId ?? `scheduler:${job.id}`,
      });

      job.state = job.state ?? {};
      job.state.lastStatus = "ok";
      job.state.lastError = undefined;
    } catch (err) {
      job.state = job.state ?? {};
      job.state.lastStatus = "error";
      job.state.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Job failed: ${job.name}`, err);
    }

    job.state.lastRunAtMs = startedAt;
    job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now());
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
