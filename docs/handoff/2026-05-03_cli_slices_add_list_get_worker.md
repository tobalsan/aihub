# Worker Findings — issue 02 CLI slices add/list/get

## Status
Completed.

## Commit
Pending (not created yet in this run).

## Files changed
- `packages/extensions/projects/src/cli/slices.ts`
- `packages/extensions/projects/src/cli/slices.test.ts`
- `packages/extensions/projects/src/cli/index.ts`
- `packages/extensions/projects/src/index.ts`
- `apps/gateway/src/cli/index.ts`
- `/Users/thinh/.worktrees/aihub/projects_slices_refactor/progress.md`
- `docs/handoff/2026-05-03_cli_slices_add_list_get.md`

## What implemented
- Added top-level `aihub slices` command registration in gateway CLI.
- Added slices CLI command group in projects extension:
  - `add --project <PRO-XXX> "<title>"`
  - `list [--project <id>] [--status <s>]`
  - `get <sliceId>`
- Uses slice storage primitives from `projects/slices.ts`.
- Resolves `get <sliceId>` by scanning projects across projects root + `.archive` + `.done`.
- Added explicit error messages:
  - `Project not found: <id>`
  - `Slice not found: <sliceId>`

## Tests added
- `packages/extensions/projects/src/cli/slices.test.ts`
  - add creates slice + prints ID
  - list no flags
  - list filters `--project` + `--status`
  - get resolves across projects
  - errors for missing project/slice

## Checks run
- `pnpm install` ✅ (workspace deps missing initially)
- `pnpm test:cli` ✅

## Blockers
None.
