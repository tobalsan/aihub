# Scope map generator handoff (issue 03)

## Summary
Implemented deterministic `SCOPE_MAP.md` generator in slice storage layer.

### Done
- Added `regenerateScopeMap(projectDir, projectId)` in `packages/extensions/projects/src/projects/slices.ts`.
- Output format matches spec §9 with auto-generated header + table.
- Deterministic ordering by slice ID.
- Atomic write via existing temp+rename helper.
- Concurrent regens on same project serialized with per-project lock dir (`.meta/.scope-map.lock`).
- Wired regen into `createSlice`, so `aihub slices add` now creates `SCOPE_MAP.md` immediately on first slice.
- Exported API from `projects/index.ts`.

### Tests added/updated
- `packages/extensions/projects/src/projects/slices.test.ts`
  - empty project regeneration
  - single/multi slice deterministic order
  - atomic write/no temp leftovers
  - concurrent regens serialize
- `packages/extensions/projects/src/cli/slices.test.ts`
  - `slices add` now asserts `SCOPE_MAP.md` exists + contains created row

## Checks
- `pnpm exec vitest run packages/extensions/projects/src/projects/slices.test.ts` ✅
- `pnpm test:cli` ✅

## Notes
- Task-provided `context.md` and `plan.md` not found in this worktree.
- Ran `pnpm install` first since `node_modules` missing.
