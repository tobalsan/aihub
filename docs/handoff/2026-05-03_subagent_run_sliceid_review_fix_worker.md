# Issue 07 reviewer fix worker

## Status
Completed.

## Fixes applied
1. Orchestrator spawn path now passes `sliceId` on worker + reviewer spawn inputs (`projectSliceId(project)`), and test coverage asserts dispatched spawn input carries `sliceId`.
2. `POST /projects/:id/subagents` now accepts optional `sliceId` and forwards into `spawnSubagent()`.
3. `SubagentGlobalListItem` now includes optional `sliceId` and optional `projectId`.
4. Global subagent list now reads/emits `sliceId` from `config.json` or `state.json` (with `projectId` fallback).
5. Added tests for legacy-missing and attributed slice behavior on per-project + global list surfaces.

## Files changed
- `packages/extensions/projects/src/orchestrator/dispatcher.ts`
- `packages/extensions/projects/src/orchestrator/index.test.ts`
- `packages/extensions/projects/src/index.ts`
- `packages/extensions/projects/src/subagents/index.ts`
- `packages/extensions/projects/src/subagents/subagents.api.test.ts`
- `packages/shared/src/types.ts`
- `docs/handoff/2026-05-03_subagent_run_sliceid.md`

## Checks
- `pnpm vitest run packages/extensions/projects/src/orchestrator/index.test.ts packages/extensions/projects/src/subagents/subagents.api.test.ts` ✅
- `pnpm test:shared` ✅
- `pnpm test:gateway` ✅
