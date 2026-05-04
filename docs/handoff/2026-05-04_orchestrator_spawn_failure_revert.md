# Orchestrator Spawn Failure Revert

## Context

PRO-240-S11 fixes the slice orchestrator Worker spawn failure path. Failed Worker spawns should not leave slices stuck in `in_progress`.

## Changes

- Worker spawn failures now call `updateSlice(..., { status: "todo" })`.
- Successful reverts log `action=spawn_failed_revert` with the spawn error.
- Revert failures log `action=revert_failed` with both the revert error and original spawn error.
- Dispatch decisions use `reason: "spawn_failed"` for failed spawns.
- Added tests for thrown spawn errors, `{ ok: false }` spawn errors, mixed success/failure ticks, and revert failure logging.

## Validation

- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`
- `pnpm --filter @aihub/extension-projects test`
- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/extension-projects build`
