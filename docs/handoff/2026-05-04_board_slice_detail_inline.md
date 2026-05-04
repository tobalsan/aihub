# Board Slice Detail Inline

## Context

PRO-240-S03: slice cards opened the legacy `/projects/:projectId/slices/:sliceId`
page from the Board project detail Slices tab, leaving the Board lifecycle tab and
resetting adjacent UI state.

## Changes

- `BoardProjectDetailPage` now passes `onSliceClick` to `SliceKanbanWidget` and
  renders `SliceDetailPage` inside the Slices tab pane.
- `SliceDetailPage` accepts optional `projectId`, `sliceId`, `onBack`, and
  `onOpenSlice` props while preserving route-param behavior for legacy routes.
- Board-hosted slice detail uses `history.pushState`/`popstate` so browser back
  and forward mirror the in-pane slice detail state.
- Added a focused Board project detail test for opening a slice inside the tab.

## Validation

- `pnpm exec vitest run apps/web/src/components/board/BoardProjectDetailPage.test.tsx apps/web/src/components/SliceDetailPage.test.tsx`
- `pnpm test:web`
- `pnpm typecheck`
