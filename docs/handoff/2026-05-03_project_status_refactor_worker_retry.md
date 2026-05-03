Issue 05 retry complete.

Implemented + validated:
- lifecycle project statuses (`shaping|active|done|cancelled|archived`)
- legacy status rejection w/ migrate hint
- cancel cascade from project to non-terminal child slices
- preserve done slices on cancel
- auto `active -> done` when all child slices terminal and >=1 done
- best-effort orchestrator run interrupt for cascaded sliceIds

Key fixes during retry:
- store test failure after cancel: project path moves to `.done`; assertions now use `cancelled.data.absolutePath`
- gateway test fixture: `in_progress` replaced with `active`
- shared schema: add `active` to `ProjectStatusSchema` so PATCH accepts lifecycle status before store validation

Files touched:
- `packages/extensions/projects/src/projects/store.ts`
- `packages/extensions/projects/src/projects/slices.ts`
- `packages/extensions/projects/src/projects/index.ts`
- `packages/extensions/projects/src/index.ts`
- `packages/extensions/projects/src/projects/store.test.ts`
- `packages/shared/src/types.ts`
- `apps/gateway/src/server/space-merge.api.test.ts`

Checks run:
- `pnpm test:shared` PASS
- `pnpm test:gateway` PASS

Blockers: none.
