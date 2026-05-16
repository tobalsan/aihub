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

## Recommended Implementation Order

1. Fix `GET /api/subagents` filtering.
2. Add tests around filtered runtime subagent listing.
3. Measure Agent tab again on `mac-studio`.
4. Route `/projects` through cached board list behavior or cache `GET /api/projects`.
5. Cache board lifecycle metadata.
6. Lazy-load Agent tab logs/transcripts.

This order attacks the measured multi-second scans first while preserving the filesystem-backed project model.
