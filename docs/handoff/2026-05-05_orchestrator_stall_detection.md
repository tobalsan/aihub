# Orchestrator Stall Detection

Implemented S06 stall detection for project slices.

- Added `extensions.projects.orchestrator.stall_threshold_ms` with a 30-minute default.
- The orchestrator daemon now carries an in-memory stall tracker and checks active-project slices before dispatch.
- `in_progress` and `review` slices older than the threshold with no live run get one structured `stall_detected` log and one Orchestrator THREAD comment.
- Any live subagent run with matching `sliceId` counts as live, including manual runs; orchestrator-only filtering remains for dispatch concurrency.
- Suppression resets when the slice status changes, so a slice that leaves and later returns to a stalled status can be reported again.

Validation:

- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`
- `pnpm --filter @aihub/shared --filter @aihub/extension-projects build`
