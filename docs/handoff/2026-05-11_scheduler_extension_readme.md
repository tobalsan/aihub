# Scheduler extension README

Added `packages/extensions/scheduler/README.md` to document the scheduler
extension at the same level of detail as the `subagents` and `projects`
extension READMEs.

## What the README covers

- Purpose, opt-in via `extensions.scheduler`, and the `heartbeat` dependency.
- Persistence: a single `$AIHUB_HOME/schedules.json` file with the
  `{ version, jobs[] }` shape and per-job `state` (`nextRunAtMs`,
  `lastRunAtMs`, `lastStatus`, `lastError`).
- Configuration knobs: `enabled` (only — see the `tickSeconds` removal handoff below).
- Schedule kinds (sourced from `packages/shared/src/types.ts`):
  - Interval (`everyMinutes`, optional `startAt` anchor) with the
    `nextRunAtMs = startMs + (floor(elapsed/intervalMs) + 1) * intervalMs`
    behavior from `src/schedule.ts`.
  - Daily (`HH:MM`, optional IANA `timezone`) with DST-safe wall-clock
    handling via `Intl.DateTimeFormat`.
- Execution semantics from `src/service.ts`:
  - Inactive-agent skip (`ctx.isAgentActive`) advances `nextRunAtMs` and
    records nothing.
  - Unknown `agentId` records `lastStatus: "error"`.
  - Default `sessionId` is `scheduler:<jobId>`.
  - Ticks are serialized; missed runs do not back-fill.
- HTTP routes: `GET/POST /api/schedules`, `PATCH/DELETE /api/schedules/:id`,
  with curl examples for create/update/delete.
- Worked examples: interval, daily with timezone, anchored interval, routing a
  job into the agent's main session via `sessionId: "agent:<id>:main"`, and
  pausing a job via `enabled: false`.

## Source of truth

- `packages/extensions/scheduler/src/index.ts` (route table + lifecycle)
- `packages/extensions/scheduler/src/service.ts` (timer arming, execute path)
- `packages/extensions/scheduler/src/schedule.ts` (next-run math)
- `packages/extensions/scheduler/src/store.ts` (file layout)
- `packages/shared/src/types.ts` (`IntervalScheduleSchema`,
  `DailyScheduleSchema`, `ScheduleJobSchema`,
  `SchedulerExtensionConfigSchema`, `Create/UpdateScheduleRequestSchema`)

## Follow-ups not in scope

- `docs/llms.md` still references a legacy `src/scheduler/` path; the
  extension now lives under `packages/extensions/scheduler/`. Worth a sweep
  when next touching that doc.
- There is no `aihub scheduler` CLI today; the README explicitly says so and
  uses `curl`. If a CLI is added later, mirror the projects/subagents README
  command layout.
