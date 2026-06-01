# Orchestrator restart reattach

- Added startup reattach for unfinished orchestrator runs.
- Daemon now checks persisted `subagent_run_id` with `getSubagentRun()` before orphaning old runs.
- Active subagent runs restore in-memory claim state and run metadata, so terminal release and hooks still work after gateway restart.
- Dead/missing subagent runs are marked finished and their claims are released.
- Dispatch now checks an existing unfinished run for the same issue and reattaches/skips instead of starting a duplicate worker.

Validation:

- `pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts`
- `pnpm --filter @aihub/extension-orchestrator build`
