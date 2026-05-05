# 2026-05-05 — Project Lifecycle Inner Swap

## Context

PRO-245-S03 fixed the board home lifecycle detail navigation. Opening a project from the Project lifecycle canvas previously used router navigation to `/board/projects/:id`, which remounted `BoardView` when starting from the board home and cleared left chat state.

## Change

- `BoardView` now keeps embedded project, slice, and tab navigation inside the canvas by updating `window.history` and local parsed board-route state.
- `BoardProjectDetailPage` accepts embedded `sliceId`, `tab`, and `onNavigate` props so project tabs and slice detail tabs do not force a router remount.
- Direct board project and board slice URLs still hydrate the same embedded view after refresh.

## Validation

- `pnpm exec vitest run apps/web/src/components/BoardView.test.tsx apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
- Browser validation against `AIHUB_HOME=$(pwd)/.aihub pnpm dev` on `http://127.0.0.1:3001/`:
  - left board chat textarea sentinel survived project opens and project switches
  - board chat container DOM data attribute survived project switches
  - direct refresh on `/board/projects/PRO-2` restored detail view
  - board-hosted slice sub-tabs stayed under `/board/projects/PRO-1/slices/PRO-1-S01`
  - slice kanban realtime showed a CLI-added slice without refresh
  - project drag from shaping to active succeeded
