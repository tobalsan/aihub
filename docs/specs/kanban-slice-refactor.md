# Kanban Slice Refactor — Spec

*Drafted via /drill-specs — 2026-05-03*

## 1. Problem statement

AIHub's kanban currently treats **projects** as the unit of flow. Projects move through `maybe → shaping → todo → in_progress → review → ready_to_merge → done`. Re-reading Shape Up makes clear this conflates two concepts:

- **Project** — a 6-week bet, a container for a pitch and its scope map. Doesn't move through a flow cadence.
- **Slice** (Shape Up: "scope") — a vertical slice that "can be built, integrated, and finished independently of the rest of the project." This is the natural unit of flow.

Putting projects on a kanban means each card represents weeks of work with internal structure the kanban can't see. Slices are the right granularity for both human kanban hygiene and agentic dispatch (each slice = one Worker run, one Reviewer run, one done-criterion).

This refactor introduces slices as a child of projects, makes them the kanban unit, and re-keys the orchestrator from `projectId` to `sliceId`.

## 2. Goals

1. Slices are the kanban unit; projects become containers tracked at their own lifecycle level (no kanban for projects).
2. Existing projects on disk migrate cleanly into the new model with zero data loss.
3. Worker + Reviewer subagents bind to slices, not projects. Behavior parity with v0.1/v0.2 dispatcher, just keyed by slice.
4. Project-level lifecycle UI lives in the `board` extension (consumes `projects` extension as backend); the slice kanban + data model lives in `projects` extension.
5. The `board` extension's project lifecycle UI ships as part of this refactor (no UX gap post-refactor).

## 3. Non-goals (parked)

- **Shaper agent** (v0.3 idea): operates at project level, not in this refactor.
- **Slicer agent** (v0.3 idea): proposes slices automatically; not in this refactor. Slices are created manually in v1.
- **v0.4 reliability work**: reconciliation, exponential-backoff retries, stall detection, ready-to-merge ping. Will port cleanly once refactor lands.
- **Linear sync.**
- **PRO-234 follow-ups** (auto-archive done >7d, branch info on dedupe-merged worktree rows, project create form).

## 4. Vocabulary & taxonomy

| Term | Meaning |
|------|---------|
| Project | A 6-week bet. Container. Holds pitch (README), high-level thread, scope map, slices/. Lifecycle but no kanban. |
| Slice | Vertical, independently finishable scope. Kanban card. Holds own SPECS/TASKS/VALIDATION + thread. Unit of agent dispatch. |
| Pitch | Project README.md content: appetite, no-gos, rabbit holes. |
| Scope map | Generated index (`SCOPE_MAP.md`) of slices under a project. |
| Hill position | Per-slice metadata: `figuring`, `executing`, `done`. Surfaced as a future hill chart view. |

## 5. Data model

### 5.1 Filesystem layout (post-refactor)

```
~/projects/<PRO-XXX>/
  README.md              # pitch (appetite, no-gos, rabbit holes)
  THREAD.md              # project-level discussion (decisions, pitch chatter)
  SCOPE_MAP.md           # generated index of slices
  .meta/
    counters.json        # { lastSliceId: <int> }   per-project slice counter
  slices/
    <PRO-XXX-Snn>/
      README.md          # slice card (frontmatter + must/nice sections)
      SPECS.md           # slice spec
      TASKS.md           # checklist (grows as work happens)
      VALIDATION.md      # done-criteria
      THREAD.md          # slice-level discussion (Worker/Reviewer chatter)
```

### 5.2 ID schemes

- **Project ID** — unchanged. Global counter in `projects.json` (`lastId`). Format `PRO-NNN`.
- **Slice ID** — **parented format `<PRO-XXX>-S<nn>`**, per-project counter stored at `<projectDir>/.meta/counters.json` (`lastSliceId`). Globally unique by virtue of the parent prefix. Examples: `PRO-238-S01`, `PRO-238-S02`, `PRO-201-S01`.

### 5.3 Slice card schema (slice `README.md`)

```markdown
---
id: PRO-238-S03
project_id: PRO-238
title: Auth flow
status: in_progress
hill_position: executing   # figuring | executing | done
created_at: 2026-05-03T10:00:00Z
updated_at: 2026-05-03T10:00:00Z
---

## Must
- login
- signup

## Nice
- ~2FA
- ~SSO
```

`~`-prefixed nice-to-haves are convention from the kanban-taxonomy doc — kept for parity with Shape Up cards.

### 5.4 Status enums

**Project** lifecycle (no kanban, just states):

```
shaping → active → done
              ↘ cancelled
```

- `shaping`: pre-slices. New projects start here. Can be moved to `active` only manually (this is the human review gate before Workers start).
- `active`: orchestrator may dispatch slices belonging to this project.
- `done`: auto-transition when all child slices are terminal (`done` or `cancelled`) **and** at least one is `done`. User can override.
- `cancelled`: terminal. Cancelling cascades — see §5.6.

**Slice** kanban statuses:

```
todo → in_progress → review → ready_to_merge → done
                                              ↘ cancelled
```

- New slices land in `todo`. Project-level gate (parent must be `active`) determines whether the orchestrator picks them up.
- `ready_to_merge` is terminal-for-orchestrator. User merges branch, then manually moves slice to `done`. No auto-cascade to project status from Reviewer.
- `cancelled` is terminal. Slices have no separate archive/trash — `cancelled` is enough; project archive sweeps slices with the parent.

### 5.5 Project gate for orchestrator dispatch

The dispatcher only considers slices whose parent project is in `active` status. Slices in `todo` under a `shaping` or otherwise-non-`active` project are visible on the board but not auto-pulled.

### 5.6 Cancellation cascade

When a project moves to `cancelled`:
- Every non-terminal child slice (anything not `done` or `cancelled`) moves to `cancelled`.
- Any active orchestrator runs on those slices are killed (initial implementation: best-effort SIGTERM via existing run state; full reconciliation lands in v0.4).
- Slices already `done` stay `done`.

### 5.7 Subagent run attribution

`SubagentRun` schema gains:

```ts
SubagentRun {
  ...existing fields,
  parent?: SubagentParent  // existing
  projectId?: string       // denormalized parent for cross-slice queries
  sliceId?: string         // primary attribution (new)
}
```

Both fields populated for new runs. Legacy runs (created before refactor) are **not backfilled** — they keep their existing attribution via `parent`/`cwd` walk and surface in the UI without a `sliceId`. This is acceptable since they predate slices.

### 5.8 Worktree path

```
<worktreeDir>/<PRO-XXX>/<PRO-XXX-Snn>-<slug>/
```

e.g. `~/.worktrees/PRO-238/PRO-238-S03-feat-auth-flow/`

Reuses existing `extensions.projects.worktreeDir` setting. Project namespace preserved at the directory level; slice ID baked into slug for human readability. Smallest disk migration footprint.

### 5.9 Cooldown / dedupe keys

- `OrchestratorAttemptTracker` — keyed by `sliceId`. One slice failing doesn't block sibling slices.
- `isActiveOrchestratorRun` — filters by `sliceId` (and `cwd` as fallback for legacy runs).
- Dispatch concurrency — `max_concurrent` per status binding still applies, counted against active runs across all slices for that profile.

## 6. Orchestrator behavior

### 6.1 Config

Config key location: **kept at `extensions.projects.orchestrator`** (no rename). Inconsistent with the model (it now dispatches slices) but avoids backward-compat friction. Schema unchanged:

```yaml
extensions:
  projects:
    orchestrator:
      enabled: true
      poll_interval_ms: 30000
      failure_cooldown_ms: 60000
      worktreeDir: ~/.worktrees   # existing
      statuses:
        todo:
          profile: Worker
          max_concurrent: 1
        review:
          profile: Reviewer
          max_concurrent: 1
```

No reserved slots for future Shaper/Slicer config — added when those agents ship.

### 6.2 Dispatcher loop (post-refactor)

For each configured status binding `(statusKey, profile, max_concurrent)`:

1. Enumerate all slices in `statusKey` whose parent project is `active`.
2. Filter out slices with active orchestrator runs.
3. Filter out slices in cooldown (per-slice tracker).
4. Cap by `max_concurrent` against currently-running matched profile runs.
5. Dispatch profile against each remaining slice. Move slice `todo → in_progress` for Worker (existing lock pattern).
6. Existing in-tick `running` flag + `failure_cooldown_ms` dedupe stack carries forward.

### 6.3 Worker prompt

Worker context: **pitch + scope map only** from project, full slice docs.

Reads:
- Parent project: `README.md` (pitch), `SCOPE_MAP.md` (sibling slice index, titles only).
- Slice: `README.md` (must/nice), `SPECS.md`, `TASKS.md`, `VALIDATION.md`.

Plus a **"stay in your slice"** clause in the prompt: Worker must not modify other slices' files, and must not modify project-level docs without explicit instruction.

On completion: Worker hands off via `aihub slices move <sliceId> review`.

### 6.4 Reviewer prompt

Reads same project + slice context as Worker. `workerWorkspaces` lookup filters by `sliceId` (most-recent orchestrator-source Worker run on this slice). Single workspace passed in.

Outcomes:
- Pass → slice `review → ready_to_merge`. Project status untouched. User merges branch and manually moves slice to `done`.
- Fail → slice `review → todo` + Reviewer posts a comment to slice `THREAD.md` listing gaps.

## 7. UI

### 7.1 `projects` extension (data + slice kanban widget)

- Owns slice data model, project data model, slice kanban widget, slice detail view.
- Removes the existing project kanban view.
- Slice kanban is **scoped per-project** (no cross-project slice list). It is rendered as the "Slices" tab inside the project detail page hosted by the `board` extension. Reusable widget, single project at a time.
- Adds:
  - `SliceKanbanWidget` — props: `projectId`. Columns: `todo | in_progress | review | ready_to_merge | done | cancelled`. Always live (no realtime suspension).
  - `SliceDetailPage` — full slice card view (specs, tasks, validation, thread, runs).
- Routes (slice detail only — list comes from board ext):
  - `/projects/:projectId/slices/:sliceId` — slice detail (canonical, nested).
  - Optional flat `/slices/:sliceId` — 302s to canonical nested URL.

### 7.2 `board` extension (project lifecycle UI)

In scope for this refactor. See §15 for full sub-spec. Summary:

- Project list grouped by lifecycle state (active + shaping expanded; done + cancelled collapsed).
- Project detail page with tabs: Pitch | Slices (kanban widget) | Thread | Activity.
- Drag-to-change-status on the project list.
- Live runs view (`/board/agents`) grouped by project, with kill action.
- Scratchpad (existing) kept.
- Areas filter chips kept.
- Consumes `projects` extension as backend; embeds `SliceKanbanWidget` for the Slices tab.
- The `board` extension does not own kanban data — it hosts the `projects` ext widget.

## 8. CLI

Slice operations are top-level: `aihub slices <verb>`.

| Command | Behavior |
|---------|----------|
| `aihub slices add --project <PRO-XXX> "<title>"` | Create slice. Lands in `todo`. Allocates next per-project counter. Appends to SCOPE_MAP. |
| `aihub slices list [--project <id>] [--status <s>]` | List slices, optional filters. |
| `aihub slices get <sliceId>` | Show slice detail. |
| `aihub slices move <sliceId> <status>` | Change status. |
| `aihub slices comment <sliceId> "<body>"` | Append to slice THREAD.md. |
| `aihub slices rename <sliceId> "<title>"` | Rename. |
| `aihub slices cancel <sliceId>` | Move to cancelled. |

Existing `aihub projects ...` surface kept; project-level commands unchanged in shape. Cancel/done semantics gain cascade as in §5.6.

Migration command:

| `aihub projects migrate-to-slices` | Idempotent. Wraps each legacy project's SPECS/TASKS/VALIDATION into `slices/<PRO-XXX>-S01/`, generates SCOPE_MAP, sets project status (typically `active` for projects with non-terminal status, mapped per §10). **Refuses to run if gateway is detected running** — user stops gateway, migrates, restarts. |

## 9. SCOPE_MAP.md

Auto-generated from `slices/*/README.md`. Regenerated on every slice add/rename/move/delete. Hand edits are overwritten — communicated to the user via a header comment.

```markdown
<!-- Auto-generated by aihub. Do not edit by hand. -->
# Scope map — PRO-238

| Slice | Title | Status | Hill |
|-------|-------|--------|------|
| PRO-238-S01 | Auth flow | in_progress | executing |
| PRO-238-S02 | Profile page | todo | figuring |
| PRO-238-S03 | Settings | done | done |
```

## 10. Migration

### 10.1 Status mapping

Legacy project status → post-refactor (project status, default slice status):

| Legacy | Project | Slice (`PRO-XXX-S01`) |
|--------|---------|-----------------------|
| `not_now` | `shaping` | n/a (no slice created if not_now) |
| `maybe` | `shaping` | n/a (project shaped but un-sliced) |
| `shaping` | `shaping` | `todo` (slice created but parent gate prevents dispatch) |
| `todo` | `active` | `todo` |
| `in_progress` | `active` | `in_progress` |
| `review` | `active` | `review` |
| `ready_to_merge` | `active` | `ready_to_merge` |
| `done` | `done` | `done` |
| `cancelled` | `cancelled` | `cancelled` |
| `archived` | `archived` (existing semantics) | unchanged |

Note: `not_now` and `maybe` legacy projects are NOT auto-sliced — their status maps to `shaping` and the user creates slices manually when ready. Avoids creating thousands of speculative slices for parked ideas.

### 10.2 Procedure (per project)

1. Read existing `SPECS.md`, `TASKS.md`, `VALIDATION.md` (whichever exist).
2. Allocate `PRO-XXX-S01`. Increment `<projectDir>/.meta/counters.json`.
3. Create `<projectDir>/slices/PRO-XXX-S01/`. Move SPECS/TASKS/VALIDATION there. Create slice README with frontmatter (title = project title, status mapped per table, hill_position = `figuring` default). Initialize empty slice THREAD.
4. Generate SCOPE_MAP.md.
5. Update project frontmatter status per mapping.
6. Project README.md remains as-is (legacy descriptions become the pitch).
7. Project THREAD.md remains as-is.

Idempotent: if `slices/` already exists, skip the project.

### 10.3 Live runs

CLI refuses to run if gateway PID is detected. User stops gateway, migrates, restarts. New runs created post-restart attribute correctly. Existing run state.json files are not rewritten.

## 11. Persistence changes

- `projects.json` — unchanged (lastId for project counter).
- `<projectDir>/.meta/counters.json` — **new**, per-project (`lastSliceId`).
- `<projectDir>/SCOPE_MAP.md` — **new**, generated.
- `<projectDir>/slices/` — **new** subtree.
- Subagent run state.json — gains optional `projectId` and `sliceId` fields. Legacy files untouched. New runs always populate both.

No DB schema migration (subagent runs are JSON files; multi-user SQLite is unaffected).

## 12. Success criteria (Definition of Done)

1. Dispatcher iterates slice statuses + project gate (`shaping` slices not dispatched).
2. Worker + Reviewer prompts read pitch + scope map (project) + slice docs only.
3. `workerWorkspaces` lookup filters by `sliceId`.
4. Cooldown per-slice; dedupe keyed by `sliceId`.
5. `aihub projects migrate-to-slices` runs idempotently against existing `~/projects/`. All legacy projects migrate without data loss.
6. CLI surface complete: `aihub slices {add,list,get,move,comment,rename,cancel}`.
7. Web UI: slice kanban (cross-project) + nested slice detail route in `projects` ext.
8. `board` ext: project lifecycle dashboard + project detail with embedded scope map.
9. Project cancellation cascades to non-terminal slices.
10. Auto active→done when all child slices terminal and ≥1 done.
11. `pnpm test:web`, `pnpm test:gateway`, `pnpm test:shared`, `pnpm test:cli` all pass.
12. `docs/llms.md` updated to reflect new model.
13. Handoff doc written under `docs/handoff/`.
14. End-to-end smoke test: spawn one project, slice it, dispatch Worker → Reviewer → ready_to_merge → done on the new model.

## 13. Risks / open items

- **Cancellation kill-running** is best-effort until v0.4 reconciliation lands. May leave orphan subagent processes briefly. Acceptable in v1.
- **SCOPE_MAP regeneration races** if multiple slice mutations happen concurrently. File-level write must be atomic (temp file + rename). Existing project store has the pattern; reuse.
- **Legacy run attribution gap** — old runs surface without `sliceId`. UI shows "pre-slice run" badge or similar. Confirm with user during implementation.
- **Hill position UX** — schema reserved, no UI yet for moving the dot. Static field for now; future hill chart view consumes it.
- **Inconsistent naming** — `extensions.projects.orchestrator` config key dispatches slices. Documented in llms.md as historical artifact.
- **`board` extension scope creep** — full project lifecycle UI is non-trivial. Carve carefully when slicing this refactor's own slices.

## 14. Implementation note

This refactor will itself be carved into vertical slices using a dedicated slicing skill (out of scope of this spec). The refactor project (`PRO-XXX kanban-slice-refactor`) becomes the first project shaped + sliced under the new model — appropriate dogfooding.

Until the refactor lands, the orchestrator stays at v0.2. Workers and Reviewers continue auto-pulling against the project kanban. Nothing breaks; we just don't extend the wrong abstraction further.

---

## 15. `board` extension rebuild (sub-spec)

Drilled via /drill-specs as part of this refactor. The `board` extension is the project lifecycle UI; it does not own kanban data — it hosts the `projects` ext slice kanban widget inside project detail.

### 15.1 Architecture

- **Data flow:** `board` ext consumes `projects` ext APIs (project + slice CRUD, area filters, run state). No new persistence introduced by `board` ext.
- **Backend endpoints (existing, retained + extended):**
  - `GET /board/info` — board metadata.
  - `GET /board/projects` — project list with lifecycle status, slice progress, last activity, active run count, area.
  - `GET /board/areas` — area summaries (filter source).
  - `GET /board/agents` — live orchestrator + manual subagent runs (cross-project).
  - `GET /board/scratchpad` — quick notes (existing).
  - `POST /board/projects/:id/move` — change lifecycle status (drag target). Validates transition; rejects invalid moves with structured error.
  - `POST /board/agents/:runId/kill` — kill a live run (SIGTERM). Confirmation handled in UI.
- **Web UI components (under `apps/web/src/components/board/`):** reuse existing `DocEditor` (Tiptap WYSIWYG), `TasksEditor`, `ProjectDetailPanel` shell. New components: `ProjectListGrouped`, `AgentsView`, `ActivityFeed`.

### 15.2 Project list view (board home)

**Layout:** flat list grouped by lifecycle status. Order:

1. `active` (expanded by default)
2. `shaping` (expanded by default)
3. `done` (collapsed by default — header `done (N) [show]`)
4. `cancelled` (collapsed by default)

`archived` projects are not shown on board home (existing semantics retained).

**Top of page:**

- Search box: title + ID full-text match.
- Area filter chips: `[ All ][ <area> ][ <area> ]` derived from `/board/areas`. Clicking a chip filters the project list.

**Card content (rich):**

- Line 1: `PRO-XXX  [status pill]  area:<name>`
- Line 2: project title
- Line 3: progress bar `n/m slices done` + active run dot if any
- Line 4: `updated <relative> by <actor>`

**Interactions:**

- Click card → project detail page (`/projects/:projectId`).
- Drag card between status sections → calls `POST /board/projects/:id/move`. Allow any target; backend validates. On reject, toast with the error reason. Examples:
  - `active → done` rejected if not all slices terminal (rule from §5.4).
  - `active → shaping` rejected as a demote (use detail page menu if explicit override needed).
- Right-click → context menu (later iteration; not v1).

**States:**

- Empty: `"No projects yet"` with `[+ Create]` CTA.
- Error: `"Failed to load projects."` with `[Retry]`.
- Loading: skeleton rows (3 per visible group).

### 15.3 Project detail page

**Route:** `/projects/:projectId`. Header: ID, title, status pill, area, lifecycle action menu (`Move to active`, `Cancel`, `Archive`, `Unarchive`).

**Tabs:**

| Tab | Content |
|-----|---------|
| Pitch | README.md rendered + edited via `DocEditor` (Tiptap WYSIWYG). Inline save. |
| Slices | `SliceKanbanWidget` from `projects` ext, scoped to this project. Columns: `todo | in_progress | review | ready_to_merge | done | cancelled`. `[+ Add slice]` button at top. |
| Thread | THREAD.md via `DocEditor` + comment-append form. |
| Activity | Aggregated activity feed (see §15.5), scoped to this project. |

**Edit lock:** none. Concurrent edits during orchestrator runs allowed; Worker reads at dispatch time.

**Slice creation entry:** only from the Slices tab (per §15 design — slice kanban is per-project, so creation always has a parent in scope). The CLI `aihub slices add --project <PRO-XXX>` mirrors this.

### 15.4 Agents view (`/board/agents`)

**Layout:** sections grouped by project. Within each section, rows for live runs.

```
PRO-238  Auth refactor
  Worker     PRO-238-S03  started 2m ago  [view] [kill]
PRO-201  Mobile app
  Reviewer   PRO-201-S01  started 5m ago  [view] [kill]
```

**Run row columns:** profile, slice ID, started-at, action buttons.

**Actions:**

- `[view]` → existing subagent run detail page.
- `[kill]` → confirmation dialog ("Kill <profile> on <slice>?"), then `POST /board/agents/:runId/kill`. Sends SIGTERM via existing run state. Best-effort until v0.4 reconciler lands.

**Empty state:** `"No live runs."`

### 15.5 Activity feed

**Source:** stateless aggregation, no new persistence.

Inputs:

- Project frontmatter `updated_at` + `status` transitions (read from project README frontmatter — needs lightweight history; in v1, just the latest transition timestamp).
- Slice frontmatter `updated_at` + `status` transitions.
- Subagent run state.json: `started_at`, `completed_at`, exit status, profile, sliceId.
- THREAD.md / slice THREAD.md additions (parsed entries with timestamps).

Output: chronological list, newest first.

**Scope:**

- Board-home activity feed: cross-project (top N entries, ~50, on dashboard or sidebar).
- Project-detail Activity tab: scoped to that project + all its slices + their runs.

**Item shape (UI):**

```
2m ago   Worker run completed     PRO-238-S03   [view run]
5m ago   PRO-201-S01 → review     manual move
12m ago  PRO-238 → active         status change
```

Initial implementation aggregates on each request (cached briefly). If proven slow under §15.7 budgets, revisit by writing an event log (out of scope for v1).

### 15.6 Realtime

- Project list: live (subscribe to project + slice + run events). Re-render on changes.
- Detail page: live across all tabs, including while WYSIWYG editor is focused. No suspension. Last-write-wins on saves; collisions accepted as low-frequency for the user's scale.
- Agents view: live.
- Scratchpad: live.

### 15.7 Performance budget

Target scale: ~50 projects, ~10 slices each, ~100 active runs total at peak.

- `GET /board/projects` p95 < 300ms.
- Project detail load p95 < 500ms.
- `GET /board/agents` p95 < 300ms.
- No virtual scrolling required.
- Activity feed: cap at 100 entries per request; skip projects fully collapsed in dashboard view.
- Existing 10s `projectResultCache` retained.

### 15.8 Areas

Existing `/board/areas` endpoint retained. Frontmatter `area` field shown as a chip on each card and used as a filter at top of project list. No new schema. If a project has no area, render no chip and treat as "uncategorized" in filters.

### 15.9 Scratchpad

`/board/scratchpad` endpoint and existing UI panel retained as-is. No work in this refactor.

### 15.10 Multi-user

Out of scope for v1. Existing `agent_assignments` table is not surfaced on the board. Add later if needed.

### 15.11 Accessibility / responsive

- Keyboard navigation supported on project list (arrow keys + enter).
- Drag-to-change-status: provide a fallback for keyboard users via the lifecycle action menu on card focus (`m` shortcut → menu).
- Mobile: not optimized in v1; layout degrades gracefully (single-column stack).

### 15.12 Out of scope (board ext, v1)

- Project create form (PRO-234 follow-up; CLI remains the create path).
- Bulk operations on projects.
- Per-user dashboards / saved filters.
- Right-click context menus.
- Mobile-optimized layout.
- Persistent activity event log.
- Project-level @mentions / notifications.

### 15.13 Success criteria (board ext)

1. Project list grouped by status with active+shaping expanded, done+cancelled collapsed; counts visible.
2. Search + area filter chips functional on the list.
3. Project card displays rich content (status, area, progress, last activity, run dot).
4. Drag-to-change-status calls validated backend; rejected transitions surface a toast.
5. Project detail page has all four tabs (Pitch, Slices, Thread, Activity); WYSIWYG editor reused for Pitch and Thread.
6. Slices tab embeds `SliceKanbanWidget` scoped to the project, with `[+ Add slice]`.
7. `/board/agents` view shows live runs grouped by project with kill action; killing a run sends SIGTERM and disappears from the list once exit detected.
8. Activity feed surfaces project + slice + run events without new persistence.
9. Empty/error/loading states styled per §15.2.
10. Realtime updates flow without suspension across all views.
11. Tests added for new endpoints (`POST /board/projects/:id/move`, `POST /board/agents/:runId/kill`) and new components.
12. `pnpm test:web` + `pnpm test:gateway` pass.

### 15.14 Risks

- **Drag UX edge cases.** Validate on drop = optimistic UI may briefly show wrong state before toast. Mitigation: optimistic move with revert on reject.
- **Activity feed cost.** Stateless aggregation may scale poorly. Mitigation: §15.7 caps + cache; switch to event log only if measured slow.
- **Kill-run reliability.** Pre-v0.4 reconciler, killed processes may leave orphan worktrees or stale state.json. Document the limitation; full reliability ships in v0.4.
- **WYSIWYG vs realtime.** Live updates while editing may stomp local edits. Acceptable per §15.6 (last-write-wins). Revisit if user reports lost edits.
