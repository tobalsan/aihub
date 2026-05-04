# Slice Kanban Realtime

## Context

PRO-240-S12 fixes stale Slice Kanban columns after external slice status changes.

## Changes

- Slice POST/PATCH routes emit `file_changed` websocket events for slice `README.md` and `SCOPE_MAP.md` immediately after successful mutations.
- `SliceKanbanWidget` subscribes through a normal Solid effect and debounces matching project file changes by 250ms before refetching.
- External blocker project changes also refetch blocker slice data so blocked badges update live.

## Validation

- `pnpm exec vitest run apps/web/src/components/SliceKanbanWidget.test.tsx`
- `pnpm exec vitest run packages/extensions/projects/src/projects/slices.api.test.ts`
- `pnpm typecheck`
