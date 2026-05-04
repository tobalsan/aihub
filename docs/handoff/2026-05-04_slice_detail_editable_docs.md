# Slice Detail Editable Docs

PRO-240-S05 made slice detail document tabs editable in place.

- `apps/web/src/components/SliceDetailPage.tsx` now uses the shared board `DocEditor` for README, SPECS, TASKS, VALIDATION, and THREAD tabs.
- Slice doc saves optimistically call `updateSlice(projectId, sliceId, { <doc>: content })`; failures revert local state and show an inline save error.
- `packages/extensions/projects/src/projects/slices.api.test.ts` covers PATCH doc updates and confirms README frontmatter is preserved on disk.
- Lint-only cleanup was also required for existing repo lint failures in board/project test files and projects helpers.

Validation run:
- `pnpm exec vitest run apps/web/src/components/SliceDetailPage.test.tsx`
- `pnpm exec vitest run packages/extensions/projects/src/projects/slices.api.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src/projects/slices.test.ts`
- `pnpm typecheck`
- `pnpm lint` (passes with warnings only in `apps/gateway/src/sdk/pi/__tests__/session-repair.test.ts`)
