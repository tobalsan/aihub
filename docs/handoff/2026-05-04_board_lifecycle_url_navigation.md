# Board Lifecycle URL Navigation

## Summary

Implemented PRO-240-S13. Board lifecycle project/detail navigation now uses shareable URLs without leaving the Board shell:

- `/board/projects` opens the Board shell with the Project lifecycle tab active.
- `/board/projects/:projectId` opens project detail inline in the lifecycle tab.
- `/board/projects/:projectId?tab=<projectTab>` restores Pitch/Slices/Thread/Activity.
- `/board/projects/:projectId/slices/:sliceId?tab=<sliceTab>` restores inline slice detail and slice inner tab.

## Code

- `apps/web/src/App.tsx` routes board project and nested slice URLs to `BoardHomeRouteShell`.
- `apps/web/src/components/BoardView.tsx` derives lifecycle project selection from router params and keeps Board canvas on Project lifecycle for `/board/projects*`.
- `apps/web/src/components/board/BoardProjectDetailPage.tsx` derives project tabs and selected inline slice from route/query state.
- `apps/web/src/components/SliceDetailPage.tsx` derives inner document tab from `?tab=` and writes board-hosted slice tab URLs when embedded.

## Validation

- `pnpm exec vitest run apps/web/src/components/board/BoardProjectDetailPage.test.tsx apps/web/src/components/SliceDetailPage.test.tsx apps/web/src/components/BoardView.test.tsx`
