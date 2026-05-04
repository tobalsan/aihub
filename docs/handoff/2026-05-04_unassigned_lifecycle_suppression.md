# 2026-05-04 — Unassigned Lifecycle Suppression

## Context

PRO-240-S02: the board lifecycle grouped list showed the synthetic `__unassigned`
project in the Shaping bucket. Clicking it routed to project detail and rendered a
blank page.

## Change

- `apps/web/src/components/board/ProjectListGrouped.tsx` now excludes
  `__unassigned` before lifecycle filtering/grouping/counting.
- `apps/web/src/components/board/ProjectListGrouped.test.tsx` covers the
  synthetic-only input case and asserts it is not rendered or counted.

The board API still returns `__unassigned` for legacy orphan worktree surfaces
such as `ProjectsOverview`; only the lifecycle grouped project list suppresses it.

## Validation

- `pnpm exec vitest run apps/web/src/components/board/ProjectListGrouped.test.tsx`
- `pnpm test:web`
- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src`
