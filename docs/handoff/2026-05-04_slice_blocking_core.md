# 2026-05-04 Slice Blocking Core

Implemented PRO-241-S01 core slice blocking:

- Slice frontmatter supports optional `blocked_by: string[]`; empty lists are omitted on write.
- Orchestrator builds a global slice status index per tick and skips Worker/Reviewer candidates with pending blockers, logging `reason=blocked_by_pending` and `pending=<ids>`.
- CLI supports `aihub slices block <sliceId> --on <ids>` and `aihub slices unblock <sliceId> [--from <ids>]` with existence, self-block, and cycle validation.
- Slice block/unblock CLI mutations use `updateSlice` and record activity events.

Validation:

- `pnpm --filter @aihub/extension-projects test` exits 0 but the package has no `test` script.
- `pnpm exec vitest run packages/extensions/projects/src` passed: 25 files, 228 tests.
- `pnpm --filter @aihub/shared build` passed.
- `pnpm --filter @aihub/extension-projects build` passed.
