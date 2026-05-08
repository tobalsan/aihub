# Projects UI Refresh

## Summary

Refreshed the Projects extension around the simplified project lifecycle model while preserving the current Board UI surface.

## Implemented

- Project statuses are now simplified around `triage | shaping | active | ready_to_merge | done | cancelled`.
- New projects default to `triage` unless an explicit status is provided.
- Legacy statuses normalize as follows:
  - `maybe`, `not_now` → `triage`
  - `todo`, `in_progress`, `review` → `active`
- Projects kanban columns now render `Triage`, `Shaping`, `Active`, `Ready to merge`, and `Done`.
- Projects kanban expanded column state now supports any number of expanded columns.
- Projects home archive panel was removed; the header Archive action routes to `/projects/archive`.
- Added `/projects/archive` page with separate Archived and Cancelled groups.
- Project quick-create stores the initial idea/prompt body in `README.md`, leaving `PITCH.md` for shaping agents to create/refine.
- Create-form attachments append to the `README.md` body.
- Area selection in the create form is now an autocomplete with deferred `+ Create "area"` behavior; the area is only created on submit.
- `/projects/:projectId` and `/projects/:projectId/slices/:sliceId` now reuse `BoardProjectDetailPage` through a route adapter, translating Board URLs to Projects URLs and preserving the left nav shell.
- Board project detail status handling was extended to tolerate `triage` and `ready_to_merge` statuses.
- Area cards/counts were updated to the simplified status set.

## Key Files

- `packages/shared/src/types.ts`
- `packages/shared/src/projectPrompt.ts`
- `packages/extensions/projects/src/projects/document-store.ts`
- `packages/extensions/projects/src/projects/store.ts`
- `packages/extensions/projects/src/use-cases/update-project-lifecycle.ts`
- `packages/extensions/board/src/projects.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/api/projects.ts`
- `apps/web/src/api/types.ts`
- `apps/web/src/api/board.ts`
- `apps/web/src/components/ProjectsBoard.tsx`
- `apps/web/src/components/project/ProjectsArchivePage.tsx`
- `apps/web/src/components/project/ProjectsDetailRouteAdapter.tsx`
- `apps/web/src/components/board/BoardProjectDetailPage.tsx`
- `apps/web/src/components/AreaCard.tsx`
- `apps/web/src/components/AreasOverview.tsx`

## Validation

- `pnpm --filter @aihub/web build`
- `pnpm test:shared`
- `pnpm exec vitest run packages/extensions/projects/src/projects/document-store.test.ts packages/extensions/projects/src/projects/store.test.ts packages/extensions/projects/src/projects/projects.api.test.ts`
- `pnpm test:web`

## Notes

A worker subagent implemented the Projects detail route adapter and archive page. A reviewer subagent identified integration issues around the create form, archive status handling, stale types, and tests; those were addressed in the integration pass.
