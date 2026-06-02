---
title: "Orchestrator slice 06: StateStore (SQLite runs/events/claims/heartbeats + orphan sweep)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Local SQLite persistence at `$AIHUB_HOME/orchestrator/state.db` via `better-sqlite3`. Tables: `runs` (workspace, repo, branch, profile snapshot, workflow path + sha, turn, PID, exit info, head shas, `finished_at`, `process_alive`), `events` (append-only worker/hook/tool events keyed to `run_id`), `claims` (`issue_id → run_id`, `claimed_at`, `released_at`), `heartbeats` (one row per daemon: PID, last_tick, version). In-memory `claims` map remains authoritative; SQLite is append-only log + claim-fairness audit + restart visibility.

Daemon startup performs an orphan sweep: any `runs` row with `finished_at IS NULL` AND `process_alive=0` (which is the steady-state after a graceful shutdown sets the flag) is marked `outcome=orphaned`, its claim is released, and its on-disk workspace is preserved for inspection.

This slice deliberately does not add new HTTP routes or CLI verbs; the next two slices do that.

## Acceptance criteria

- [ ] `StateStore.bootstrap()` creates the schema on a fresh DB and is idempotent on subsequent boots.
- [ ] `insertRun / finishRun / appendEvent / listRecent / listEvents / markOrphaned` round-trip correctly under unit tests against a temp DB.
- [ ] Dispatch path writes a `runs` row on claim, an append-only `events` row per worker/hook/tool event, and a `claims` row on claim + release.
- [ ] Daemon writes a `heartbeats` row at startup and updates `last_tick` each tick.
- [ ] Graceful shutdown sets `process_alive=0` on active runs; ungraceful shutdown leaves them at `1`, and the next startup detects unfinished `process_alive=0` rows is the boundary (the design uses the gap to identify orphans — verify via integration test that a crash-then-restart marks the prior run `outcome=orphaned` on next boot).
- [ ] Restart mid-run does not double-claim: the next tick sees the issue still in `Todo` / `In Progress` but the claims map starts empty; the orphan sweep prevents re-dispatching until Linear state moves through a terminal state or the operator releases.
- [ ] `sqlite3 $AIHUB_HOME/orchestrator/state.db "select * from runs order by started_at desc limit 5"` returns sensible rows after a few runs.

## Blocked by

- Slice 01 (tracer E2E loop).
