# Board Projects Worktree Agent State

Phase 3 of PRO-234 enriches `/api/board/projects` with `worktrees[]`.

Changes:
- Board joins project metadata with cached Space queue entries via `getCachedSpace(config, projectId)`.
- Board includes `_space` worktree entries when not covered by queue entries.
- Board keeps legacy `name`, `path`, `dirty`, and `ahead` fields on worktree entries for existing UI callers.
- Subagents exports `getLiveSubagentRunsByCwd()`, an in-memory live-run index keyed by cwd.
- Board matches live runs by exact resolved worktree path and maps runtime `error` status to board `failed`.
- Space cache watcher accepts an optional change callback; board uses it to invalidate project endpoint cache on `space.json` changes.
- Board also invalidates project endpoint cache on `subagent.changed`.

Verification:
- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts`
- `pnpm exec vitest run packages/extensions/subagents/src/runtime.test.ts packages/extensions/projects/src/projects/space-cache.test.ts`
- `pnpm -w build`
- Synthetic profile run: 50 projects x 3 queued worktrees, 25 warmed requests to `/api/board/projects?profile=true`, `X-Profile-Ms` p50 = 0 ms.
