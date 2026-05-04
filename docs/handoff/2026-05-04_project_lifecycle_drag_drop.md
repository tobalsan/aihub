# 2026-05-04 Project Lifecycle Drag Drop

Slice: PRO-240-S06.

Implemented drag/drop and keyboard lifecycle moves for `ProjectListGrouped`.

- Added an `archived` drop zone and per-card status select.
- Kept card click navigation separate from drag gestures and status changes.
- Kept optimistic card movement until parent data catches up; failed moves roll back and show the existing toast.
- Extended board move validation so every lifecycle status can be a target, preserving the `active -> done` slice terminal check.
- Routed `archived` moves through `archiveProject()` and archived-source moves through `unarchiveProject()`.

Validation run:

- `pnpm exec vitest run apps/web/src/components/board/ProjectListGrouped.test.tsx`
- `pnpm exec vitest run packages/extensions/board/src/move-lifecycle.test.ts`
- `pnpm test:web`
- `pnpm exec vitest run packages/extensions/board/src`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm exec vitest run apps/web/src/components/board/ProjectListGrouped.test.tsx apps/web/src/components/board/BoardProjectDetailPage.test.tsx packages/extensions/board/src/move-lifecycle.test.ts packages/extensions/projects/src/cli/migrate.test.ts packages/extensions/projects/src/orchestrator/index.test.ts`
