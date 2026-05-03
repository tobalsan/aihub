---
title: SubagentRun schema gains `sliceId` / `projectId`
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md (§5.7, §5.9)
---

## What to build

Extend `SubagentRun` schema with two optional fields and update active-run lookup paths.

```ts
SubagentRun {
  ...existing fields,
  parent?: SubagentParent  // existing
  projectId?: string       // denormalized parent for cross-slice queries
  sliceId?: string         // primary attribution (new)
}
```

- New runs always populate both fields.
- Legacy runs untouched — surface in UI without `sliceId` (acceptable, predates slices).
- `isActiveOrchestratorRun` lookup filters by `sliceId` with `cwd` fallback for legacy runs.
- `OrchestratorAttemptTracker` keyed by `sliceId`.

## Acceptance criteria

- [ ] Schema + types updated in `shared`
- [ ] Run state.json read tolerates missing `sliceId`/`projectId` (legacy)
- [ ] New runs persist both fields
- [ ] `isActiveOrchestratorRun(sliceId)` returns true for matching active run, falls back to `cwd` match for legacy
- [ ] `OrchestratorAttemptTracker` keyed by `sliceId` (one slice failing doesn't block siblings)
- [ ] Unit tests cover legacy-tolerant read + new-field write + tracker isolation
- [ ] `pnpm test:shared` + `pnpm test:gateway` pass

## Blocked by

None - can start immediately
