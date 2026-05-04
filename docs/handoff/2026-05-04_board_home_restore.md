# Board home restore

## Context

User reported `/` on preview ports 3001/4001 showed black loading blocks instead of chat + scratchpad after kanban slice refactor.

## Changes

- Fixed `ProjectListGrouped` loading/error rendering: removed non-reactive early returns; loading/error now reactive via `<Show>` fallbacks.
- Routed board home (`capabilities.home === "board"`) back to `BoardView` in `apps/web/src/App.tsx`.
- Kept `/board` as standalone lifecycle list route.
- Replaced `BoardView` Projects tab content with `BoardLifecycleListPage` and renamed tabs:
  - `Chat + Scratchpad` (default)
  - `Project lifecycle`
- Updated `BoardView` tests for lifecycle list tab.
- Updated `docs/llms.md` board home note.

## Validation

- `pnpm exec vitest run apps/web/src/components/board/ProjectListGrouped.test.tsx apps/web/src/components/BoardView.test.tsx --exclude '.aihub/**'` passed.
- `pnpm test:web` passed: 35 files, 247 tests.
- Playwright live preview verified `/` shows chat + scratchpad default and project lifecycle second tab; lifecycle list no longer stuck on loading skeleton.
