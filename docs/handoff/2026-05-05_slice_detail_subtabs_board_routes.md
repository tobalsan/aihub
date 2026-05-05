# Slice Detail Subtabs Board Routes

PRO-245-S03 fixed slice detail sub-tab navigation escaping the board-hosted project lifecycle chrome.

Changes:
- `SliceDetailPage` accepts `routeBase?: "board" | "standalone"` and uses it when building sub-tab URLs.
- `BoardProjectDetailPage` passes `routeBase="board"` for inline slice detail.
- Legacy `ProjectDetailPage` slice kanban clicks route to `/board/projects/:projectId/slices/:sliceId`.
- Added focused tests for board route preservation.

Validation:
- `pnpm exec vitest run apps/web/src/components/SliceDetailPage.test.tsx`
- `pnpm exec vitest run apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
