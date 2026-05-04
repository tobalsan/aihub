# Board Suspense Flash Fix

## Context

PRO-240-S01 fixed post-merge Board UI flashes where opening a project from the lifecycle tab, or opening the project Slices tab, could suspend up to the route-level Board boundary and briefly remount the chat shell.

## Changes

- Added a canvas-local `<Suspense>` boundary in `BoardView` around `CanvasPanelRenderer`, so project detail loads stay in the right pane.
- Added a Slices-tab-local `<Suspense>` boundary around `SliceKanbanWidget`, so slice resource loads do not blank the project detail header/tabs or Board chat.
- Added regression coverage that wraps the affected components in parent Suspense boundaries and verifies loading stays below them.

## Validation

- `pnpm exec vitest run apps/web/src/components/BoardView.test.tsx apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
- `pnpm test:web`
- Browser checked at `http://localhost:3001/` with `agent-browser`: project click and Slices tab activation kept the same `.board-chat` and `.board-chat-input` DOM nodes and did not show the route-level splash.
