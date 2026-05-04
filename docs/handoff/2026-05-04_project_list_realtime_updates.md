# Project List Realtime Updates

## Slice

PRO-240-S08 — Project list: real-time updates on create/move/cancel.

## Changes

- `POST /api/projects` now emits a `file.changed` event for the new project's README after creation, so open board tabs refetch without waiting on filesystem watcher timing.
- `POST /api/board/projects/:id/move` now emits a matching `file.changed` event after the lifecycle move and direct cache invalidation.
- Board project cache invalidation now responds to any project markdown file change, not only README changes, so slice/thread/spec changes can refresh board card metadata.
- `BoardLifecycleListPage` keeps the existing 250ms debounce and dedupes repeated `subagent_changed` events by run status to avoid heartbeat refetch churn.

## Validation

- `pnpm exec vitest run apps/web/src/components/board/BoardLifecycleListPage.test.tsx`
- `pnpm exec vitest run packages/extensions/board/src/index.test.ts packages/extensions/projects/src/projects/projects.api.test.ts`
- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/extension-projects --filter @aihub/extension-board build` initially required built workspace deps.
- `pnpm --filter @aihub/extension-subagents build`
- `pnpm --filter @aihub/extension-board build`
