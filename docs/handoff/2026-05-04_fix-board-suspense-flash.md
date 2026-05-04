# Fix board Suspense flash during subagent runs

## Symptom

While a subagent stream was active, the entire `div.board` subtree under
`div.left-nav-main` repeatedly detached and re-attached, producing a visible
full-board flash that disrupted the chat side, the agent dropdown, and
everything else inside `BoardView`.

## Diagnosis

Live MutationObserver + `fetch` instrumentation in the browser:

- Same DOM node identity (`data-flashId` survived) on every detach/attach.
- Child count grew while detached (e.g. 2344 → 2523), consistent with Solid
  `<Suspense>` offscreen behavior — children keep updating in a hidden
  fragment, then get reattached when the boundary resolves.
- Each remove/add aligned 1:1 with `/api/board/projects?include=done`
  request start/finish.

Root cause chain:

1. `apps/web/src/App.tsx:403–405` wraps `<LazyBoardView/>` in `<Suspense>`
   with no closer boundary. That single boundary covers the whole board.
2. `apps/web/src/components/board/BoardLifecycleListPage.tsx`
   `createResource(() => fetchBoardProjects(true))` and
   `createResource(fetchAreaSummaries)` are read with `projects()` /
   `areas()`, which suspend the boundary while a refetch is in flight.
3. The same component subscribes to `subscribeToFileChanges` and
   `subscribeToSubagentChanges` and calls `refetchProjects()` on each
   change (debounced 250 ms). During a subagent run those events fire
   constantly, producing back-to-back refetches and back-to-back
   suspensions of the entire `<LazyBoardView/>`.

## Fix

Read the resources via `.latest` instead of calling them. `.latest` returns
the most recent resolved value without participating in Suspense, so
refetches no longer re-suspend the App-level boundary. `loading` and
`error` continue to flow through `projects.loading` / `projects.error` so
the skeleton and error branches in `ProjectListGrouped` are unaffected.

Two-line change in `BoardLifecycleListPage.tsx`:

```diff
-        projects={projects() ?? []}
-        areas={(areas() ?? []).map((area) => ({
+        projects={projects.latest ?? []}
+        areas={(areas.latest ?? []).map((area) => ({
```

## Verification

- `pnpm test:web` — 35 files, 249 tests passing.
- `BoardLifecycleListPage.test.tsx` (2 tests) still passing.
- Manual repro to be confirmed in-browser by the user after merge.
