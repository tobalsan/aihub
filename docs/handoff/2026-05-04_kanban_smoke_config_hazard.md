# Handoff — 2026-05-04 — smoke-kanban-slice AIHUB_HOME config hazard

## Issue
`docs/validation/kanban-slice-refactor-report.html` follow-up #2 valid: `scripts/smoke-kanban-slice.sh` wrote `$AIHUB_HOME/aihub.json` when caller exported `AIHUB_HOME`. This mutated active worktree/user config.

## Fix implemented
File: `scripts/smoke-kanban-slice.sh`

- Script now always creates isolated temp home:
  - `SMOKE_AIHUB_HOME="$(mktemp -d)"`
  - `export AIHUB_HOME="$SMOKE_AIHUB_HOME"`
- Caller `AIHUB_HOME` captured only for logging (`ORIGINAL_AIHUB_HOME`).
- Script writes seed config only inside isolated temp home.
- Cleanup removes isolated home unless `KEEP_HOME=1`.
- Added explicit startup log line showing isolation and preserved caller home.

Result: smoke no longer mutates caller/worktree `AIHUB_HOME/aihub.json`.

## Validation
Ran guarded dry run with pre-seeded external config checksum before/after:

- Command: `AIHUB_HOME=<external_home> bash scripts/smoke-kanban-slice.sh`
- External `aihub.json` hash before == after (unchanged).
- Script used separate temp AIHUB_HOME (confirmed in output).

Note: one run reported `pnpm test:web` failure inside smoke suite (existing suite noise, unrelated to config-mutation fix). Config-preservation assertion still passed.

## Files changed
- `scripts/smoke-kanban-slice.sh`
