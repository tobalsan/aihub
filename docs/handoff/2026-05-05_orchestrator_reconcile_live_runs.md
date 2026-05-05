# Orchestrator Reconcile Live Runs

Implemented `reconcileLiveRuns()` in the projects orchestrator dispatcher. Each tick now checks running orchestrator subagents with `sliceId` before dispatching new work and interrupts runs whose expected slice status no longer matches current state.

Expected active statuses:

- Worker: `in_progress`
- Reviewer: `review`
- Merger: `ready_to_merge`

Legacy running orchestrator sessions without `sliceId` are ignored.

Validation:

- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src`
- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/extension-projects build`
