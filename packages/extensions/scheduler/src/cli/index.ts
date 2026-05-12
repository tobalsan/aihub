import { Command } from "commander";
import { createInterface } from "node:readline";
import type {
  CreateScheduleRequest,
  ScheduleJob,
  UpdateScheduleRequest,
} from "@aihub/shared";
import { SchedulerApiClient } from "./client.js";
import {
  buildScheduleFromOpts,
  defaultJobName,
  renderJobsTable,
  type JobWithState,
  type ScheduleInputOpts,
} from "./schedule-input.js";

type CreateOpts = ScheduleInputOpts & {
  agent: string;
  message: string;
  name?: string;
  session?: string;
  disabled?: boolean;
  json?: boolean;
};

type UpdateOpts = ScheduleInputOpts & {
  name?: string;
  enable?: boolean;
  disable?: boolean;
  message?: string;
  session?: string;
  json?: boolean;
};

type DeleteOpts = {
  yes?: boolean;
  json?: boolean;
};

type ListOpts = { json?: boolean };

type GetOpts = { json?: boolean };

function fail(err: unknown): never {
  if (err instanceof Error) console.error(err.message);
  else console.error("Request failed");
  process.exit(1);
}

function getClient(): SchedulerApiClient {
  return new SchedulerApiClient();
}

function printJobs(jobs: JobWithState[], json: boolean | undefined): void {
  if (json) {
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }
  console.log(renderJobsTable(jobs));
}

async function confirmDelete(id: string): Promise<boolean> {
  if (process.stdin.isTTY !== true) return false;
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`Delete schedule ${id}? [y/N] `, resolve)
  );
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export function buildCreateBody(opts: CreateOpts): CreateScheduleRequest {
  const schedule = buildScheduleFromOpts(opts);
  const name = opts.name?.trim() || defaultJobName(opts.agent, schedule);
  const payload: CreateScheduleRequest["payload"] = { message: opts.message };
  if (opts.session) payload.sessionId = opts.session;
  return {
    name,
    agentId: opts.agent,
    schedule,
    payload,
  };
}

export function buildUpdateBody(opts: UpdateOpts): UpdateScheduleRequest {
  const body: UpdateScheduleRequest = {};
  if (opts.enable && opts.disable) {
    throw new Error("Use either --enable or --disable, not both.");
  }
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.enable) body.enabled = true;
  if (opts.disable) body.enabled = false;

  const hasScheduleOpt =
    Boolean(opts.every) || Boolean(opts.daily) || Boolean(opts.tz) || Boolean(opts.startAt);
  if (hasScheduleOpt) {
    if (!opts.every && !opts.daily) {
      throw new Error(
        "Schedule changes require --every <dur> or --daily HH:MM (the server replaces the whole schedule)."
      );
    }
    body.schedule = buildScheduleFromOpts(opts);
  }

  if (opts.message !== undefined || opts.session !== undefined) {
    if (opts.message === undefined) {
      throw new Error("--session also requires -m <message> (server replaces payload).");
    }
    const payload: NonNullable<UpdateScheduleRequest["payload"]> = {
      message: opts.message,
    };
    if (opts.session) payload.sessionId = opts.session;
    body.payload = payload;
  }

  if (Object.keys(body).length === 0) {
    throw new Error("Nothing to update. Pass --name/--enable/--disable/--every/--daily/-m.");
  }
  return body;
}

export function registerSchedulerCommands(program: Command): Command {
  program
    .command("list")
    .description("List enabled schedules")
    .option("-j, --json", "JSON output")
    .action(async (opts: ListOpts) => {
      try {
        const jobs = await getClient().listSchedules();
        printJobs(jobs as JobWithState[], opts.json);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("get")
    .description("Show a schedule by id (enabled only)")
    .argument("<id>", "Schedule id")
    .option("-j, --json", "JSON output")
    .action(async (id: string, opts: GetOpts) => {
      try {
        const jobs = (await getClient().listSchedules()) as JobWithState[];
        const job = jobs.find((j) => j.id === id);
        if (!job) {
          console.error(`Schedule not found (or disabled): ${id}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(job, null, 2));
          return;
        }
        console.log(renderJobsTable([job]));
        console.log("");
        console.log(`message: ${job.payload.message}`);
        if (job.payload.sessionId) {
          console.log(`session: ${job.payload.sessionId}`);
        }
        if (job.state?.lastRunAtMs) {
          console.log(`last-run: ${new Date(job.state.lastRunAtMs).toISOString()}`);
        }
        if (job.state?.lastError) {
          console.log(`last-error: ${job.state.lastError}`);
        }
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("create")
    .description("Create a schedule")
    .requiredOption("--agent <id>", "Agent id to invoke")
    .requiredOption("-m, --message <text>", "Message to send on each fire")
    .option("--name <name>", "Schedule name (default: <agent>-<schedule>)")
    .option("--every <dur>", "Interval, e.g. 2m, 1h, 1d")
    .option("--daily <HH:MM>", "Daily wall-clock time (24h)")
    .option("--tz <iana>", "IANA timezone for --daily")
    .option("--start-at <iso>", "ISO 8601 anchor for --every")
    .option("--session <id>", "Session id override")
    .option("--disabled", "Create disabled (requires re-enable via API; id is returned)")
    .option("-j, --json", "JSON output")
    .action(async (opts: CreateOpts) => {
      try {
        const body = buildCreateBody(opts);
        const client = getClient();
        let job = (await client.createSchedule(body)) as JobWithState;
        if (opts.disabled) {
          job = (await client.updateSchedule(job.id, { enabled: false })) as JobWithState;
        }
        printJobs([job], opts.json);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("update")
    .description("Update a schedule")
    .argument("<id>", "Schedule id")
    .option("--name <name>", "Rename")
    .option("--enable", "Enable the schedule")
    .option("--disable", "Disable the schedule")
    .option("--every <dur>", "Switch to interval (e.g. 2m, 1h)")
    .option("--daily <HH:MM>", "Switch to daily")
    .option("--tz <iana>", "Timezone (with --daily)")
    .option("--start-at <iso>", "Anchor (with --every)")
    .option("-m, --message <text>", "Replace payload message")
    .option("--session <id>", "Replace payload session id (requires -m)")
    .option("-j, --json", "JSON output")
    .action(async (id: string, opts: UpdateOpts) => {
      try {
        const body = buildUpdateBody(opts);
        const job = (await getClient().updateSchedule(id, body)) as JobWithState;
        printJobs([job], opts.json);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("enable")
    .description("Enable a schedule")
    .argument("<id>", "Schedule id")
    .option("-j, --json", "JSON output")
    .action(async (id: string, opts: GetOpts) => {
      try {
        const job = (await getClient().updateSchedule(id, {
          enabled: true,
        })) as JobWithState;
        printJobs([job], opts.json);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("disable")
    .description("Disable a schedule")
    .argument("<id>", "Schedule id")
    .option("-j, --json", "JSON output")
    .action(async (id: string, opts: GetOpts) => {
      try {
        const job = (await getClient().updateSchedule(id, {
          enabled: false,
        })) as JobWithState;
        printJobs([job], opts.json);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("delete")
    .description("Delete a schedule")
    .argument("<id>", "Schedule id")
    .option("-y, --yes", "Skip confirmation")
    .option("-j, --json", "JSON output")
    .action(async (id: string, opts: DeleteOpts) => {
      try {
        if (!opts.yes) {
          const ok = await confirmDelete(id);
          if (!ok) {
            console.error("Aborted.");
            process.exit(1);
          }
        }
        const result = await getClient().deleteSchedule(id);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Deleted schedule ${id}`);
      } catch (err) {
        fail(err);
      }
    });

  return program;
}

export type { ScheduleJob };
