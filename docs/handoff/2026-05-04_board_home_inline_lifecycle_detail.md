# Board home inline lifecycle detail

## Context
Follow-up to board home restore. User requested:
- First canvas tab label must be `Scratchpad`, not `Chat + Scratchpad`.
- Project lifecycle list item background must not be incorrect black.
- Clicking a project in lifecycle tab must open project detail inline inside that tab, not route to a new page.

## Changes
- `apps/web/src/components/BoardView.tsx`
  - Renamed first canvas tab to `Scratchpad`.
  - Project lifecycle tab now owns local `selectedProjectId` state.
  - List view renders `BoardLifecycleListPage` with an `onProjectClick` override.
  - Detail view renders `BoardProjectDetailPage` inline with `projectId`, `onBack`, and `onOpenProject` props.
- `apps/web/src/components/board/BoardLifecycleListPage.tsx`
  - Added optional `onProjectClick` prop.
  - Standalone `/board` still navigates to `/board/projects/:id` when no prop is supplied.
- `apps/web/src/components/board/BoardProjectDetailPage.tsx`
  - Added optional `projectId`, `onBack`, `onOpenProject` props for embedded usage.
  - Route behavior remains unchanged when props omitted.
- `apps/web/src/components/board/ProjectListGrouped.tsx`
  - Replaced dark hardcoded fallback colors (`#1e1e1e`, `#181818`, `#2a2a2a`, etc.) with theme tokens (`--bg-surface`, `--bg-base`, `--border-default`, `--text-secondary`).
- Tests updated for embedded click behavior and standalone navigation behavior.
- `docs/llms.md` updated.

## Validation
- Subagent dispatched for implementation.
- `pnpm exec vitest run apps/web/src/components/BoardView.test.tsx apps/web/src/components/board/BoardLifecycleListPage.test.tsx apps/web/src/components/board/ProjectListGrouped.test.tsx apps/web/src/components/board/BoardProjectDetailPage.test.tsx --exclude '.aihub/**'` passed: 40 tests.
- `pnpm test:web` passed: 35 files, 249 tests.
