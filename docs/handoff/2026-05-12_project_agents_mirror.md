# Project Agents Mirror

Implemented the project-level mirror of slice Agent surfaces for shaping runs.

- `BoardProjectDetailPage` now includes `Pitch | Slices | Thread | Activity | Agent`.
- Project Agent tab reuses `SubagentRunsPanel`, filtered to `projectId` runs with no `sliceId`.
- Project detail header shows a shaping run pill (`Running`, `Stalled`, `Error`) based on project-level subagent runs.
- Project detail now shows a compact Recent Runs strip for project shaping runs.
- Project lifecycle cards fetch runtime subagents and show the same project-level pill in the card header.
- Added shared helpers in `apps/web/src/lib/project-shaping-runs.ts` for filtering, sorting, elapsed labels, and pill state.
- `SubagentRunsPanel` accepts an optional client-side `filter` predicate for scope narrowing without backend schema changes.

Validation:

- `pnpm exec vitest run apps/web/src/components/SubagentRunsPanel.test.tsx apps/web/src/components/board/ProjectListGrouped.test.tsx apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
- `pnpm test:web`

Note: `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` still reports existing unrelated web type errors in lifecycle counts/archive resource/SliceDetail docs typing.
