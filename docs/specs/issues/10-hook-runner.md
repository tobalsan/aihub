---
title: "Orchestrator slice 10: HookRunner (after_create / before_run / after_run / before_remove)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

`HookRunner` executes lifecycle shell commands declared in WORKFLOW frontmatter at well-defined points in the dispatch cycle:

- `after_create` — once, immediately after a fresh workspace is created.
- `before_run` — every dispatch, before the subagent is started.
- `after_run` — after the subagent exits (success or failure); receives `AIHUB_EXIT_CODE`.
- `before_remove` — before the workspace is removed (terminal + `cleanup_on_terminal=true`, or kill).

Exec: `spawn("sh", ["-c", cmd], { cwd: workspace, env })`. Hook env: `AIHUB_ISSUE_ID`, `AIHUB_ISSUE_IDENTIFIER`, `AIHUB_WORKSPACE`, `AIHUB_REPO`, `AIHUB_BRANCH`, plus `AIHUB_EXIT_CODE` on `after_run` only. `LINEAR_API_KEY` is explicitly excluded from hook env (same boundary as worker spawn).

Hook stdout/stderr append to the run's `events` table as `hook.<phase>.stdout` / `hook.<phase>.stderr`. `before_run` failure (non-zero exit) aborts the dispatch and records `outcome=hook_failed`; other phases log the failure but do not abort the run.

## Acceptance criteria

- [ ] Each declared hook fires at the documented phase and only that phase.
- [ ] Hook env contains the documented variables; `AIHUB_EXIT_CODE` is only present on `after_run`; `LINEAR_API_KEY` is absent in every phase (verified via spawn-env snapshot test).
- [ ] Hook stdout/stderr land in SQLite `events` as `hook.<phase>.stdout|stderr` with timestamps; visible in the dashboard drawer.
- [ ] `before_run` non-zero exit aborts the dispatch, releases the claim, and writes `outcome=hook_failed`.
- [ ] `after_create` / `after_run` / `before_remove` non-zero exits are logged but do not abort the surrounding lifecycle.
- [ ] Smoke: `before_run: pnpm install` produces visible output in the dashboard drawer for the corresponding run.

## Blocked by

- Slice 03 (WorkspaceLayout).
- Slice 06 (StateStore).
