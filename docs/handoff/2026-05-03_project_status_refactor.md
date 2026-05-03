# Issue 05 Project Status Refactor — Handoff

## Summary
Fixed reviewer FAIL items only.

## Fixes
- Cancel interrupt path centralized in shared helper and used by both entrypoints:
  - REST `PATCH /projects/:id`
  - extension tool `project.update`
- Added explicit interrupt filtering test coverage for cancel cascade behavior:
  - only `source === "orchestrator"`
  - only `status === "running"`
  - only `sliceId` in cascaded set
  - non-matching/manual/idle not interrupted
- Updated stale lifecycle tests:
  - projects API: `todo -> shaping`
  - activity: `in_progress -> active`, action label `In Progress -> Active`
  - orchestrator: worker status binding `todo -> shaping`, lock status `in_progress -> active`
- Legacy frontmatter list scan now surfaces item-level hint instead of silent drop:
  - `frontmatter.statusValidationError` includes migrate hint
  - added test coverage

## Files Changed
- `packages/extensions/projects/src/index.ts`
- `packages/extensions/projects/src/index.test.ts`
- `packages/extensions/projects/src/projects/store.ts`
- `packages/extensions/projects/src/projects/store.test.ts`
- `packages/extensions/projects/src/projects/projects.api.test.ts`
- `packages/extensions/projects/src/activity/activity.test.ts`
- `packages/extensions/projects/src/orchestrator/dispatcher.ts`
- `packages/extensions/projects/src/orchestrator/index.test.ts`

## Checks
- `pnpm vitest --run packages/extensions/projects/src/projects/store.test.ts packages/extensions/projects/src/projects/projects.api.test.ts packages/extensions/projects/src/activity/activity.test.ts packages/extensions/projects/src/orchestrator/index.test.ts packages/extensions/projects/src/index.test.ts` ✅
- `pnpm test:shared` ✅
- `pnpm test:gateway` ✅

## Notes
- Task-referenced `/context.md` and `/plan.md` paths not present in worktree.
