# Slice Repo Invariant

Implemented PRO-242-S13.

- Added a shared repo normalization/invariant path for slice create/update and project repo clearing.
- `aihub slices add` and `POST /api/projects/:id/slices` now accept `repo`; invalid slice repos still use the existing absolute git repo validation.
- Clearing `project.repo` with slices that rely on it now returns a 400, including the archived-status `PATCH /projects/:id` path.
- Board slice creation now surfaces API errors instead of silently swallowing them.

Validation run:

- `pnpm exec vitest run packages/extensions/projects/src/projects/slices.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src/projects/store.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src/projects/projects.api.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src/cli/slices.test.ts`
- `pnpm exec vitest run apps/web/src/components/SliceKanbanWidget.test.tsx`
- `pnpm exec vitest run apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
- `pnpm typecheck`
- `pnpm lint`
