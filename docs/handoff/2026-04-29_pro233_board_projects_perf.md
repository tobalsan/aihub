# PRO-233 Board Projects Perf

Implemented:

- Board `scanProjects()` reads project metadata concurrently and builds one worktree index per request.
- `~/.worktrees` branch discovery is one pass; dirty/ahead checks run only for branches matching non-done projects.
- `git worktree list --porcelain` runs once per unique repo and merges with root-scan results using canonical-path dedupe.
- Board skips `.done`.
- Projects extension moves `done` and `cancelled` projects to `.done`, lists them, resolves them for get/update/comments/attachments/spec tasks/subagents, and watches `.done` paths.
- Project watcher no longer root-watches the projects tree for session changes; it discovers existing `PRO-*/sessions` directories, filters to agent dirs and `state.json`, and closes errored watchers with a warning.

Verified:

- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src/projects/store.test.ts packages/extensions/projects/src/projects/tasks.test.ts packages/extensions/projects/src/projects/watcher.test.ts packages/extensions/projects/src/projects/watcher.events.test.ts packages/extensions/projects/src/projects/watcher.fs.test.ts`
- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/extension-board build`
- `pnpm --filter @aihub/extension-projects build`
- `npx vitest run packages/extensions/projects/src/projects/watcher.test.ts packages/extensions/projects/src/projects/watcher.events.test.ts packages/extensions/projects/src/projects/watcher.fs.test.ts`

Note:

- `pnpm --filter board test` and `pnpm --filter @aihub/board test` match no package in this repo; the board package is `@aihub/extension-board` and has only a `build` script, so the exact Vitest file was used.
