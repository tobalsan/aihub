# Board Worktree Dedupe

## Context

Fixed duplicate worktree rows in the Board Projects Overview detail pane when Space queue data points at an old workspace root while git worktree discovery finds the current worktree path.

## Changes

- `packages/extensions/board/src/projects.ts`
  - `canonicalPath()` now expands `~` before `realpath`/`resolve`.
  - Board worktree join now tracks both canonical path keys and logical `projectId + workerSlug` keys.
  - Git branches `space/<projectId>` map to `_space`; `space/<projectId>/<worker>` and `<projectId>/<worker>` map to that worker slug.
  - `AIHUB_BOARD_WORKTREE_DIAGNOSTICS=1` logs each source entry as `raw=<path> canonical=<path>` during `buildProjectWorktreeViews`.
- `packages/extensions/board/src/projects.test.ts`
  - Added a regression test for stale Space `.workspaces` paths versus git-discovered worktrees under another root, including `_space`.
- `docs/llms.md`
  - Documented the slug-based dedupe and diagnostics flag.

## Verification

- Real PRO-227 diagnostic run showed Space paths under `/Users/thinh/projects/.workspaces/PRO-227/...` while git discovery returned `/Users/thinh/.worktrees/PRO-227/...`.
- `curl http://127.0.0.1:4107/api/board/projects?profile=true` returned PRO-227 with 8 worktrees and no duplicate worker or `_space` rows. `X-Profile-Ms: 61`.
- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts` passed.
- `pnpm build` passed.
