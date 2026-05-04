# Handoff — 2026-05-04 — Board lifecycle list fix (item 4)

## Scope
Fix validation follow-up item 4: `/board` showed legacy canvas Projects view, not grouped lifecycle board list from spec §15.2.

## What changed
1. Routed `/board` to lifecycle list page:
   - `apps/web/src/App.tsx`
   - `BoardRouteShell` now loads `BoardLifecycleListPage` (not `BoardView`).

2. Added lifecycle board home page:
   - `apps/web/src/components/board/BoardLifecycleListPage.tsx`
   - Fetches `GET /api/board/projects?include=done`.
   - Fetches area summaries (`/api/board/areas`) and maps `{id,title}` -> `{id,name}` for chips.
   - Renders `ProjectListGrouped` (existing grouped UI implementation).
   - Adds realtime refetch on file/subagent change events (debounced 250ms).
   - Card click navigates to `/board/projects/:projectId`.

3. Added test coverage:
   - `apps/web/src/components/board/BoardLifecycleListPage.test.tsx`
   - Verifies project/area load, area title mapping, card click navigation.

4. Updated LLM context doc:
   - `docs/llms.md`
   - Added explicit `/board` lifecycle-home behavior fact.

## Behavior now
- `/board` shows grouped lifecycle sections:
  - active (expanded)
  - shaping (expanded)
  - done (collapsed)
  - cancelled (collapsed)
- Search works (title + id) via existing `ProjectListGrouped`.
- Area chip filter works when board areas available.
- Rich card basics preserved from existing `ProjectListGrouped`:
  - id + status pill + area chip
  - title
  - slice progress bar
  - active-run dot
  - relative updated time

## Test run
- Command: `pnpm test:web -- BoardLifecycleListPage`
- Result: pass (`35` files, `247` tests total in run context).

## Notes
- Kept existing styling/components. Minimal wiring fix.
- `BoardView` chat/canvas component still exists in codebase, but no longer mounted on `/board` route.
