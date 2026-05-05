# 2026-05-05 Slice kanban hidden-root realtime

## Summary

Fixed slice kanban realtime updates for CLI/orchestrator mutations when the preview or runtime projects root lives under a hidden `AIHUB_HOME` path such as `.aihub/projects`.

## Changes

- Updated the project markdown watcher to watch concrete project roots instead of `**/*.md` globs that can miss hidden ancestor paths.
- Kept filtering scoped to markdown files while ignoring `sessions` and `.git`.
- Added a filesystem regression test for `file_changed` emission from `slices/<sliceId>/README.md` under a hidden root.

## Validation

- `pnpm exec vitest run packages/extensions/projects/src/projects/watcher.fs.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src/projects/watcher.events.test.ts packages/extensions/projects/src/projects/slices.api.test.ts apps/web/src/components/SliceKanbanWidget.test.tsx`
- `pnpm build`
- Browser validation against `AIHUB_HOME=$(pwd)/.aihub pnpm dev` on UI `3001`, gateway `4001`.
- Playwright CLI named session `s02` verified slice `move` across `todo`, `in_progress`, `review`, `done`, `cancelled`, plus `add`, `rename`, and `cancel` without refresh.
- S08 no-regression check verified `/board` project lifecycle list updated live after `projects move PRO-1 active`.

## Artifacts

- `validation/s02-before.png`
- `validation/s02-after-slice-realtime.png`
- `validation/s02-project-list-realtime.png`
- `validation/reviewer-screenshots/01-before.png`
- `validation/reviewer-screenshots/02-shaping-to-active.png`
- `validation/reviewer-screenshots/03-active-to-done.png`
