# Handoff — 2026-05-03 — Slice storage primitives

## Summary
Implemented slice storage primitives in projects extension. Added per-project slice counter, ID allocation, slice CRUD read/update helpers, atomic file writes, and concurrency guard for same-project ID allocation.

## Files changed
- `packages/extensions/projects/src/projects/slices.ts`
  - New module.
  - Creates `slices/` + `.meta/counters.json` on first create.
  - Allocates IDs as `PRO-XXX-Snn`.
  - Provides `createSlice`, `getSlice`, `updateSlice`, `readSliceCounters`.
  - Uses atomic write helper (tmp file + rename) for slice and counter mutations.
  - Guards counter increment with project-local lock dir (`.meta/.slice-counter.lock`) to avoid ID collision under concurrent creates.
- `packages/extensions/projects/src/projects/slices.test.ts`
  - New unit tests for create, read/update, counter persistence, ID format/allocation, frontmatter round-trip, concurrent allocation.
- `packages/extensions/projects/src/projects/index.ts`
  - Exported new slice APIs + types.
- `progress.txt`
  - Added completion note + checks run.

## API added
- `createSlice(projectDir, input)`
- `getSlice(projectDir, sliceId)`
- `updateSlice(projectDir, sliceId, input)`
- `readSliceCounters(projectDir)`

## Checks run
- `pnpm vitest run packages/extensions/projects/src/projects/slices.test.ts` ✅

## Notes
- No CLI/UI/orchestrator/migration changes.
- Next issue: wire these primitives into slice CLI/API surface and scope-map generation.
