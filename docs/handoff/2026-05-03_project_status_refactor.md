# Issue 05 Project Status Refactor — Handoff

## Summary
Continued partial work. Implemented project lifecycle status refactor and cascade behavior in project store + routes.

### Done
- Project status validation now uses lifecycle enum: `shaping | active | done | cancelled | archived`.
- Legacy statuses (`not_now|maybe|todo|in_progress|review|ready_to_merge|trashed`) rejected with migration hint:
  - `Legacy project status "<status>" no longer supported. Run \`aihub projects migrate-to-slices\`.`
- New project default status now `shaping`.
- Unarchive default status switched to `shaping`.
- Auto transition `active -> done` when all child slices terminal and at least one `done`.
- Project cancellation cascade:
  - non-terminal child slices moved to `cancelled`
  - done slices preserved
  - best-effort interrupt of running orchestrator subagent runs tied to cascaded `sliceId`s

## Tests Added/Updated
- `packages/extensions/projects/src/projects/store.test.ts`
  - rejects legacy statuses with migration hint
  - cascades cancel to non-terminal slices only
  - auto-marks project done after terminal slice completion
  - fixed path expectation after cancellation move into `.done`
- `apps/gateway/src/server/space-merge.api.test.ts`
  - updated fixture status `in_progress -> active`
- `packages/shared/src/types.ts`
  - added `active` to `ProjectStatusSchema` for API request parsing

## Checks
- `pnpm test:shared` ✅
- `pnpm test:gateway` ✅

## Notes
- Kept scope to issue 05 only.
- No changes to CLI slices commands, SCOPE_MAP, UI, migration command, dispatcher rekeying.
