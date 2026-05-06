# Handoff: slice editor refresh + thread comments

## Changes
- Prevented board project detail from refetching on nested slice markdown changes by limiting project-level realtime refreshes to top-level `PITCH.md`, `README.md`, and `THREAD.md`.
- Scoped `SliceDetailPage` file-change refetches to the current slice/top-level lifecycle files and suppresses refetches for files emitted by its own debounced document saves (`SPECS.md`, `TASKS.md`, `VALIDATION.md`, slice `README.md`, `SCOPE_MAP.md`). This avoids editor remount/scroll reset while typing.
- Added slice thread comment posting:
  - Gateway endpoint: `POST /api/projects/:id/slices/:sliceId/comments`
  - Web API helper: `addSliceComment()`
  - Slice Thread tab now has the same simple textarea + submit flow as project thread.

## Notes
- Slice comment entries are appended to `THREAD.md` using the same heading/metadata shape consumed by the existing slice thread parser.
- The endpoint returns the appended thread entry and emits slice `THREAD.md` file-change events.

## Validation
- Not run yet. Suggested scoped checks:
  - `pnpm exec vitest run apps/web/src/components/SliceDetailPage.test.tsx`
  - `pnpm test:web`
  - targeted projects API tests if adding coverage for the new endpoint.
