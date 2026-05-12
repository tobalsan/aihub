import type {
  DailySchedule,
  IntervalSchedule,
  Schedule,
  ScheduleJob,
} from "@aihub/shared";

export type ScheduleInputOpts = {
  every?: string;
  daily?: string;
  tz?: string;
  startAt?: string;
};

const DURATION_RE = /^(\d+)(m|h|d)?$/i;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function parseDurationMinutes(value: string): number {
  const match = DURATION_RE.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Use e.g. "30m", "2h", "1d".`
    );
  }
  const n = parseInt(match[1], 10);
  if (n < 1) throw new Error(`Duration must be >= 1 (got "${value}").`);
  const unit = (match[2] ?? "m").toLowerCase();
  if (unit === "m") return n;
  if (unit === "h") return n * 60;
  return n * 60 * 24;
}

export function parseDailyTime(value: string): { hour: number; minute: number } {
  const match = TIME_RE.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid time "${value}". Use HH:MM (24h).`);
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time "${value}". Hour 0-23, minute 0-59.`);
  }
  return { hour, minute };
}

export function buildScheduleFromOpts(opts: ScheduleInputOpts): Schedule {
  const hasEvery = typeof opts.every === "string" && opts.every.length > 0;
  const hasDaily = typeof opts.daily === "string" && opts.daily.length > 0;

  if (hasEvery && hasDaily) {
    throw new Error("Use either --every or --daily, not both.");
  }
  if (!hasEvery && !hasDaily) {
    throw new Error("Schedule required: pass --every <dur> or --daily HH:MM.");
  }

  if (hasEvery) {
    if (opts.tz) {
      throw new Error("--tz only applies to --daily schedules.");
    }
    const everyMinutes = parseDurationMinutes(opts.every!);
    const schedule: IntervalSchedule = { type: "interval", everyMinutes };
    if (opts.startAt) {
      const ms = Date.parse(opts.startAt);
      if (Number.isNaN(ms)) {
        throw new Error(`Invalid --start-at "${opts.startAt}". Use ISO 8601.`);
      }
      schedule.startAt = new Date(ms).toISOString();
    }
    return schedule;
  }

  if (opts.startAt) {
    throw new Error("--start-at only applies to --every schedules.");
  }
  const { hour, minute } = parseDailyTime(opts.daily!);
  const time = `${pad2(hour)}:${pad2(minute)}`;
  const schedule: DailySchedule = { type: "daily", time };
  if (opts.tz) schedule.timezone = opts.tz;
  return schedule;
}

export function defaultJobName(agentId: string, schedule: Schedule): string {
  if (schedule.type === "interval") {
    return `${agentId}-every-${formatMinutes(schedule.everyMinutes)}`;
  }
  return `${agentId}-daily-${schedule.time}`;
}

export function formatSchedule(schedule: Schedule): string {
  if (schedule.type === "interval") {
    const base = `every ${formatMinutes(schedule.everyMinutes)}`;
    return schedule.startAt ? `${base} @ ${schedule.startAt}` : base;
  }
  return schedule.timezone
    ? `daily ${schedule.time} ${schedule.timezone}`
    : `daily ${schedule.time}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export type JobWithState = ScheduleJob & {
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: "ok" | "error";
    lastError?: string;
  };
};

export function renderJobsTable(jobs: JobWithState[]): string {
  const headers = ["id", "name", "agent", "schedule", "next-run", "last-status"];
  const formatCell = (value: unknown) =>
    String(value ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\|/g, "\\|");

  const rows = jobs.map((job) => [
    job.id,
    job.name,
    job.agentId,
    formatSchedule(job.schedule),
    job.state?.nextRunAtMs
      ? new Date(job.state.nextRunAtMs).toISOString()
      : "",
    job.state?.lastStatus ?? "",
  ]);

  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(formatCell).join(" | ")} |`).join("\n");
  return [headerRow, separator, body].filter(Boolean).join("\n");
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
