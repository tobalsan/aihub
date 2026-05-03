# 2026-05-03 Project Status Refactor Fix Worker

## Result
Implemented reviewer-requested fixes for issue 05 only.

## What changed
1. Cancel -> interrupt behavior covered + centralized
- Added shared cancel interrupt helper in `packages/extensions/projects/src/index.ts`:
  - `interruptCancelledOrchestratorRuns(...)`
  - `updateProjectWithCancelInterrupt(...)`
  - precomputes cascaded slice IDs before cancel
  - best-effort interrupts only active orchestrator runs on cascaded slices
- Wired helper into both mutation entrypoints:
  - REST `PATCH /projects/:id`
  - tool path `project.update`
- Added unit test in `packages/extensions/projects/src/index.test.ts` proving filter behavior:
  - source gate (`orchestrator` only)
  - running gate (`running` only)
  - slice gate (`sliceId` in cascaded set only)

2. Stale legacy-status tests updated to lifecycle model
- `packages/extensions/projects/src/projects/projects.api.test.ts`
  - create status expectation `todo -> shaping`
- `packages/extensions/projects/src/activity/activity.test.ts`
  - patch status `in_progress -> active`
  - activity text `In Progress -> Active`
- `packages/extensions/projects/src/orchestrator/dispatcher.ts`
  - worker orchestrator target status `todo -> shaping`
  - lock transition `in_progress -> active`
- `packages/extensions/projects/src/orchestrator/index.test.ts`
  - config/status expectations aligned (`shaping`, `active`)

3. Legacy frontmatter no longer disappears in list scans
- `packages/extensions/projects/src/projects/store.ts`
  - list scan catches legacy-status validation errors
  - emits project item with `frontmatter.statusValidationError` migrate hint
  - no silent drop for legacy-status folders
- `packages/extensions/projects/src/projects/store.test.ts`
  - added coverage for list-scan legacy-status hint

## Checks run
- `pnpm vitest --run packages/extensions/projects/src/projects/store.test.ts packages/extensions/projects/src/projects/projects.api.test.ts packages/extensions/projects/src/activity/activity.test.ts packages/extensions/projects/src/orchestrator/index.test.ts packages/extensions/projects/src/index.test.ts` ✅
- `pnpm test:shared` ✅
- `pnpm test:gateway` ✅

## Blockers
- None.
- Note: task-listed `/Users/thinh/.worktrees/aihub/projects_slices_issue05/context.md` and `plan.md` not present.
