# Reviewer Workspace Pruning

Implemented PRO-242-S11.

- Reviewer dispatch now checks persisted Worker `worktreePath` values against the filesystem before building the `Active Worker Workspaces` prompt block.
- Stale Worker workspace refs are logged as `action=prune_stale_worker_workspace`.
- If all Worker workspaces for a review slice are missing, the orchestrator skips Reviewer dispatch with `action=reviewer_skipped_no_worker_workspace`.
- If no live Worker run remains, the slice is reverted from `review` to `todo`; if a live Worker still exists, the slice stays in `review`.
- Active-run dedupe is now status-aware so live Workers do not silently suppress the Reviewer no-workspace decision path.
- Gateway tests that create temp config now isolate `AIHUB_HOME`, and Discord bot teardown avoids disconnecting a gateway socket before it is connected.

Validation:

- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`
- `pnpm test:gateway`
- `pnpm exec vitest run packages/extensions/projects/src`
- `pnpm typecheck`
- `pnpm lint`
