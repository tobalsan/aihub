# Project Navigation Performance Report

## Problem Statement

Project-related UI transitions are slow on the production-like Mac Studio setup, where projects are stored on the filesystem under `~/projects`.

Observed slow interactions:

- Opening project kanban: `/aihub/projects`
- Opening a project from the kanban
- Opening a project's `Slices` tab
- Opening project or slice `Agent` tabs
- Returning from slice detail to the slices kanban
- Returning from project detail to the project kanban via the top-left back arrow

The same transitions are near-instant in dev/test configurations with only a handful of projects. The goal is to identify whether the slowness is caused by the filesystem itself or by how the app repeatedly loads project-wide data.

Current production-like dataset measured on `mac-studio`:

- Active project directories under `~/projects`: `229`
- Done project directories under `~/projects/.done`: `14`

## Investigation Summary

The slowness is not yet proven to be an inherent filesystem bottleneck. The stronger finding is that several transitions trigger broad filesystem scans, and some APIs scan all projects even when the UI asks for project-scoped data.

Measured from `mac-studio` against the local gateway at `127.0.0.1:4000`:

```text
GET /api/board/projects?profile=true
  cold: ~2.28s
  later cached: ~0.31s, then ~0.11s

GET /api/projects
  ~0.99s

GET /api/subagents?projectId=PRO-1&includeArchived=1
  ~4.3s to ~5.2s
  response: {"items":[]}
```

The `/api/subagents?...projectId...` timing is especially important: even when the filtered response is empty, the route still spends several seconds scanning broadly.

## Frontend Load Paths

### `/projects`

Route:

- `apps/web/src/App.tsx`
- `/projects` renders `ProjectsRouteShell`
- `ProjectsRouteShell` renders `ProjectsBoard`

On mount, `ProjectsBoard` immediately loads:

- `fetchProjects()` at `apps/web/src/components/ProjectsBoard.tsx`
- `fetchAllSubagents()` at `apps/web/src/components/ProjectsBoard.tsx`

API calls:

- `GET /api/projects`
- `GET /api/subagents`

This means simply opening `/projects` triggers both a full project list load and a global subagent load.

### `/projects/:id`

Route:

- `apps/web/src/App.tsx`
- `/projects/:projectId` renders `ProjectsDetailRouteShell`
- `ProjectsDetailRouteShell` renders `ProjectsDetailRouteAdapter`
- `ProjectsDetailRouteAdapter` renders `BoardProjectDetailPage`

Primary API call:

- `fetchProject(id)`
- `GET /api/projects/:id`

This path does not itself load the full project list. It loads one project detail.

### Back From Project Detail

`ProjectsDetailRouteAdapter` passes:

```ts
onBack={() => navigate("/projects")}
```

That remounts `ProjectsBoard`, which reloads:

- `GET /api/projects`
- `GET /api/subagents`

So the top-left back arrow from project detail to project kanban forces broad scans again.

### Slices Tab

`BoardProjectDetailPage` renders `SliceKanbanWidget` for the `Slices` tab.

`SliceKanbanWidget` loads:

- `fetchSlices(projectId)`
- `fetchSubagents(projectId, true)`

API calls:

- `GET /api/projects/:id/slices`
- `GET /api/projects/:id/subagents?includeArchived=true`

This is project-scoped. It does not call `fetchProjects()`.

### Slice Detail

`SliceDetailPage` loads:

- `fetchSlice(projectId, sliceId)`
- recent runs via `fetchSubagents(projectId, true)`, then filters by `sliceId`

API calls:

- `GET /api/projects/:id/slices/:sliceId`
- `GET /api/projects/:id/subagents?includeArchived=true`

This is project-scoped. It does not call `fetchProjects()`.

### Project and Slice Agent Tabs

Both project and slice Agent tabs render `AgentRunChatPanel`.

`AgentRunChatPanel.loadAll()` loads:

- `fetchAgents()`
- active lead sessions
- archived lead sessions
- `fetchRuntimeSubagents({ projectId, sliceId, includeArchived: true })`
- logs for every returned run
- transcripts for every returned lead session

Client request:

```text
GET /api/subagents?projectId=<id>&sliceId=<id>&includeArchived=1
```

The frontend sends project/slice filters, but the projects extension backend route currently ignores those filters.

## Backend Load Paths

### `GET /api/projects`

Route:

- `packages/extensions/projects/src/index.ts`
- `app.get("/projects")`
- calls `listProjects(config, { area })`

Store:

- `packages/extensions/projects/src/projects/store.ts`
- `listProjects()`
- scans root and `.done`
- calls `listProjectItemsFromRoot()` for each root

Per project, `listProjectItemsFromRoot()`:

- reads the project directory
- finds markdown files
- parses README/SPECS/frontmatter
- validates status
- resolves area-inherited repo
- calls `isValidGitRepo(resolvedRepo)`

`isValidGitRepo()` checks the repo path and `.git`.

This endpoint is uncached in the projects extension.

### `GET /api/board/projects`

Route:

- `packages/extensions/board/src/index.ts`
- `app.get("/board/projects")`

Backend work:

- `scanProjectLifecycleMetadata(root)`
- `scanProjects(root, includeDone, worktreesRoot, options)`

`scanProjects()` has in-flight dedupe and TTL cache. However, `scanProjectLifecycleMetadata()` still reads project README/frontmatter across project entries on every request to compute counts and status mapping.

This explains why cached `/api/board/projects` requests are much faster but not free.

### `GET /api/projects/:id/subagents`

Route:

- `packages/extensions/projects/src/index.ts`
- `app.get("/projects/:id/subagents")`
- calls `listSubagents(config, id, includeArchived)`

Store:

- `packages/extensions/projects/src/subagents/index.ts`
- `listSubagents()`
- resolves one project location
- migrates that one project if needed
- lists that one project's subagent run store

This path is project-scoped.

### `GET /api/subagents`

Route:

- `packages/extensions/projects/src/index.ts`
- `app.get("/subagents")`
- calls `listAllSubagents(config)`

Store:

- `packages/extensions/projects/src/subagents/index.ts`
- `listAllSubagents()`
- scans all active projects and `.done`
- migrates/list runs for each project

The route ignores query filters such as:

- `projectId`
- `sliceId`
- `includeArchived`

This is likely the biggest avoidable issue for Agent tab transitions.

## Findings

### Finding 1: `/projects` Uses the Old Uncached List Path

The visible `/aihub/projects` route uses `ProjectsBoard`, which calls `GET /api/projects`. That endpoint scans the filesystem every mount.

This differs from `/api/board/projects`, which already has TTL/in-flight caching.

Impact:

- Opening `/projects` is slow with hundreds of projects.
- Returning to `/projects` from detail remounts the page and repeats the scan.

### Finding 2: Back Navigation Forces a Full Reload

Project detail itself is not the problem. The back action navigates to `/projects`, which remounts the list page and reloads broad data.

Impact:

- Back from project detail feels slow.
- Back from nested project/slice contexts can also feel slow when it returns through `/projects`.

### Finding 3: Agent Tabs Use a Filtered Client Request but an Unfiltered Backend Scan

`AgentRunChatPanel` asks for runtime subagents filtered by `projectId` and sometimes `sliceId`.

The backend route ignores those filters and scans all projects through `listAllSubagents()`.

Impact:

- Agent tabs can take several seconds even when the target project has no runtime subagents.
- This is clearly not a filesystem-capability limit; it is avoidable broad work for a scoped request.

### Finding 4: Board Cache Helps, but Lifecycle Metadata Remains Broad Work

`/api/board/projects` improves after warm cache, but the route still recomputes lifecycle metadata by reading all project README files.

Impact:

- Warm board list requests still have non-zero scan cost.
- Event-driven invalidation exists for project cache, but lifecycle metadata is not sharing the same cached result.

### Finding 5: Slices and Slice Detail Are Mostly Scoped

The slices tab and slice detail use project-scoped APIs:

- project slices
- one slice
- project subagents

Their slowness is more likely indirect:

- parent detail data loading
- agent run loading
- remount behavior
- subagent scans in adjacent components

## Suggested Fixes

### 1. Honor Filters in `GET /api/subagents`

Priority: highest.

Expected impact: large improvement for project/slice Agent tabs.

Current behavior:

```text
GET /api/subagents?projectId=PRO-1&sliceId=PRO-1-S01&includeArchived=1
  -> listAllSubagents()
  -> scans all projects
```

Desired behavior:

- If `projectId` is present, resolve only that project.
- Use project-scoped run listing.
- Apply `sliceId`, `status`, `includeArchived`, `cwd`, and `parent` filters after reading scoped data.
- Only fall back to global scan when no project/cwd/parent scope is supplied.

Likely files:

- `packages/extensions/projects/src/index.ts`
- `packages/extensions/projects/src/subagents/index.ts`
- tests under `packages/extensions/projects/src`
- client tests if response semantics change

Verification:

- Unit/API test proving `/api/subagents?projectId=PRO-1` does not call global list behavior.
- Manual timing against `mac-studio`.

### 2. Move `/projects` Onto the Cached Board List Path

Priority: high.

Expected impact: faster project kanban open and back navigation.

Options:

- Replace `/projects` route implementation with the board lifecycle list surface.
- Or teach `ProjectsBoard` to use `/api/board/projects`.
- Or cache `GET /api/projects`, though that keeps two project-list implementations alive.

Preferred direction: converge `/projects` and `/board/projects` onto one list model instead of maintaining two filesystem scanners.

Likely files:

- `apps/web/src/App.tsx`
- `apps/web/src/components/project/ProjectsDetailRouteAdapter.tsx`
- `apps/web/src/components/board/BoardLifecycleListPage.tsx`
- potentially route adapter helpers for `/projects` URL generation

Verification:

- Opening `/projects` should call `/api/board/projects`, not `/api/projects`.
- Back from `/projects/:id` should not trigger uncached `/api/projects`.

### 3. Cache Board Lifecycle Metadata With the Board Project Cache

Priority: high.

Expected impact: lower warm-cache latency for `/api/board/projects`.

Current behavior:

- `scanProjects()` is cached.
- `scanProjectLifecycleMetadata()` is not cached and reads all project statuses every request.

Desired behavior:

- Cache lifecycle counts/statuses under the same invalidation model as board projects.
- Reuse watcher-driven invalidation already used for board scans.

Likely files:

- `packages/extensions/board/src/projects.ts`
- `packages/extensions/board/src/index.ts`

Verification:

- Repeated `GET /api/board/projects?profile=true` should show low `X-Profile-Ms`.
- Project status changes must invalidate counts correctly.

### 4. Preserve List State Across Detail Navigation

Priority: medium.

Expected impact: instant back navigation when data is already loaded.

Options:

- Use an embedded route model like `BoardView` does for `/board/projects`.
- Keep project list mounted while showing detail.
- Store last list response in a client cache with event-driven invalidation.

This should come after backend scope fixes, otherwise hidden global scans may remain.

### 5. Avoid Loading All Logs/Transcripts on Agent Tab Mount

Priority: medium.

`AgentRunChatPanel.loadAll()` loads logs for every returned run and transcripts for every returned lead session.

For projects with many runs/sessions, this can become another transition bottleneck.

Suggested behavior:

- Load run/session summaries first.
- Load the selected run/session transcript.
- Lazy-load archived or non-selected transcripts when expanded/selected.

Likely file:

- `apps/web/src/components/AgentRunChatPanel.tsx`

Verification:

- Agent tab should render sidebar quickly.
- Network panel should show logs/transcripts fetched only for selected rows.

## How to Prove Filesystem vs Loading Strategy

Before considering a database migration, run controlled measurements after the scoped-load fixes.

Suggested probes:

1. Time raw filesystem metadata scan across `~/projects`.
2. Time `GET /api/projects`.
3. Time `GET /api/board/projects?profile=true` cold and warm.
4. Time `GET /api/subagents?projectId=<real-id>&includeArchived=1`.
5. Repeat after implementing filtered `/api/subagents`.

If project-scoped endpoints become fast while global scans remain slow, the bottleneck is loading strategy, not filesystem storage.

If even project-scoped reads of one project directory remain slow, then filesystem layout, directory size, or per-project run/log structure needs deeper profiling.

## Implementation Status (2026-05-16)

Shipped:

1. `GET /api/subagents` filtering.
   - `projectId` now scopes project-backed subagent lookup to one project before filtering.
   - `sliceId`, `status`, `cwd`, and `includeArchived` are applied to scoped/global project-backed results.
   - The runtime subagents extension passes the same filters when merging runtime and project-backed runs.

2. `/projects` moved onto the cached board list path.
   - `/projects` now renders the Board lifecycle list surface.
   - Project clicks still navigate to `/projects/:id`.
   - Opening/backing into `/projects` now uses `/api/board/projects`, avoiding the old uncached `/api/projects` + global subagent load.

3. Board lifecycle metadata cache.
   - `scanProjectLifecycleMetadata()` now has TTL + in-flight caching.
   - Cache invalidates through existing board project cache invalidation/reset.
   - Lifecycle counts/statuses share the board cache lifecycle instead of rereading all README frontmatter on every warm request.

4. Tests/docs.
   - Added `/subagents?projectId=...&sliceId=...` regression coverage.
   - Added lifecycle metadata cache coverage.
   - Updated `README.md`, `docs/llms.md`, and handoff notes.

Validation run:

```text
pnpm exec vitest run packages/extensions/projects/src/subagents/subagents.api.test.ts packages/extensions/board/src/projects.test.ts
pnpm exec vitest run packages/extensions/subagents/src/index.test.ts apps/web/src/api/client.test.ts
pnpm exec tsc -b packages/extensions/projects/tsconfig.json packages/extensions/subagents/tsconfig.json packages/extensions/board/tsconfig.json apps/web/tsconfig.json --pretty false
```

Still not measured on `mac-studio` after these changes. Recommended probes remain:

```text
GET /api/board/projects?profile=true
GET /api/subagents?projectId=<real-id>&includeArchived=1
GET /api/subagents?projectId=<real-id>&sliceId=<real-slice>&includeArchived=1
```

## Why Lazy Agent Logs/Transcripts Were Not Shipped

The medium-priority fix, “avoid loading all logs/transcripts on Agent tab mount,” was investigated but reverted. A naive lazy-load pass broke existing `AgentRunChatPanel` behavior because current selection, visibility, and action semantics depend on loaded log/transcript content, not just summaries.

Current coupling points:

- Run visibility depends on log content.
  - `shouldShowRun()` hides completed setup-only runs with no visible transcript.
  - Auto-selection finds the newest visible run by inspecting normalized log items.
  - If logs are not loaded, the panel cannot distinguish “empty/setup-only” from “not loaded yet.”

- Lead session selection depends on transcript content.
  - Existing lead sessions with user messages are preferred.
  - Agent picker lock state depends on whether a transcript already has user content.
  - Without transcript data, the panel can show an unselected or editable state incorrectly.

- Refresh behavior assumes selected logs/transcripts are already available.
  - Subagent websocket events reload runs and logs together.
  - Lead-session events update sessions and immediately refresh the selected transcript.
  - Clearing all loaded maps during reload without reloading the selected entity creates empty or transient error states.

- Sidebar and row actions are sensitive to selection.
  - Legacy lead sessions hide delete/archive affordances.
  - Lazy auto-selection changed which row was selected in tests, surfacing actions that should remain hidden for that scenario.

- Pending/reply UI depends on previous transcript staying visible.
  - Lead reply pending state must show prior assistant text plus thinking indicator.
  - If selected transcript is deferred or cleared during reload, the UI briefly shows “No lead session selected” or “No visible transcript.”

Observed failures during the reverted attempt:

- auto-selected the wrong or empty run
- failed to auto-select lead sessions expected by tests
- lost selected run logs after subagent change refresh
- changed legacy lead action visibility
- produced transient undefined log state (`undefined.events`)
- hid prior lead transcript while a reply was pending

Conclusion: lazy loading is valid, but it needs a small state-model refactor first. Loading fewer files cannot be implemented safely by only deleting the `Promise.all([...all logs, ...all transcripts])` eager step.

## Recommended Procedure for Lazy Log/Transcript Loading

### Goal

Make Agent tabs render fast by loading summaries first, then loading full logs/transcripts only for the selected/expanded entity, without changing existing selection semantics.

### Step 1: Add summary fields or summary endpoint

Do not infer visibility from full logs on mount. Add enough summary metadata to each run/session list item to decide sidebar and auto-selection cheaply.

For project/runtime runs, expose one or more of:

- `hasVisibleTranscript: boolean`
- `latestVisibleText?: string`
- `latestVisibleAt?: string`
- `messageCount?: number`
- `toolCount?: number`

For lead sessions, expose one or more of:

- `hasUserMessage: boolean`
- `latestMessagePreview?: string`
- `messageCount?: number`

Best place:

- project subagent run-store summaries for project-backed runs
- runtime subagent list summaries for runtime runs
- lead session list API for lead sessions

This preserves existing UI decisions without full transcript fetches.

### Step 2: Split loaded state into “summary” vs “body”

In `AgentRunChatPanel`, model states separately:

```ts
type BodyState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; value: T }
  | { status: "error"; error: string };
```

Keep list summaries stable while body state loads. Never treat “not loaded” as “empty transcript.”

### Step 3: Preserve selection before refetch

On list refresh:

1. fetch summaries
2. keep current selected run/lead if still present
3. reload only selected body if invalidated
4. only run auto-selection when current selection is absent or user cleared it

Do not clear selected body until replacement body loads, unless selected item disappeared.

### Step 4: Lazy body fetch triggers

Fetch full body only when:

- run/session becomes selected
- archived row is expanded and selected
- websocket event affects the selected entity
- user explicitly opens a row that needs body content

Do not fetch full bodies for every sidebar row.

### Step 5: Maintain old auto-selection rules using summaries

Run auto-selection should use summary metadata:

1. last viewed lead if active and in scope
2. newest active lead with `hasUserMessage`
3. newest active lead if only one or existing behavior says so
4. newest active run with `status=running` or `hasVisibleTranscript`
5. fallback lead segment

Completed setup-only runs should remain hidden via `hasVisibleTranscript === false`.

### Step 6: Add focused regression tests

Before implementation, add tests that lock behavior:

- mount with two runs: setup-only + visible; only visible auto-selects
- mount with multiple lead sessions; expected selection/action state unchanged
- subagent websocket event reloads selected body only
- selected body remains visible while refresh is in flight
- pending lead reply keeps previous transcript visible
- non-selected run logs are not fetched on mount
- selecting a different run fetches that run’s logs
- archived rows do not fetch bodies until opened/selected

### Step 7: Rollout sequence

Recommended PR split:

1. Backend summary metadata + tests.
2. Frontend state split using summaries, but keep eager body loading temporarily.
3. Switch non-selected bodies to lazy loading behind tests.
4. Optional: add skeleton/loading affordance for selected body.
5. Measure Agent tab mount before/after on `mac-studio`.

## Recommended Implementation Order

1. Measure shipped scoped-load fixes on `mac-studio`.
2. If Agent tabs are still slow, implement lazy logs/transcripts using the procedure above.
3. Preserve list state across detail navigation if back navigation still feels slow after cached `/projects` route.

This order attacks the measured multi-second scans first while preserving the filesystem-backed project model.
