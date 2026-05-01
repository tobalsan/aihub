# Projects overview Board tab fixup

## Summary

- Restored the standalone `/projects` route to use the kanban `ProjectsBoard`.
- Embedded `ProjectsOverview` in BoardView's `Projects` tab with local selection state so it does not navigate the standalone route.
- Adjusted the Board tab host to remove padding/outer scrolling only for the embedded projects overview.

## Verification

- `pnpm exec vitest run apps/web/src/components/ProjectsOverview.test.tsx apps/web/src/components/BoardView.test.tsx apps/web/src/components/ProjectsBoard.realtime.test.tsx apps/web/src/components/ProjectsBoard.createSuccess.test.tsx apps/web/src/components/ProjectsBoard.trueModal.test.tsx`
