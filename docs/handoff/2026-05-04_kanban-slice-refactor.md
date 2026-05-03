# Handoff — Kanban Slice Refactor

**Date:** 2026-05-04  
**Branch:** `projects_slices_refactor`  
**Spec:** `docs/specs/kanban-slice-refactor.md`  
**Validation protocol:** `docs/validation/kanban-slice-refactor.md`  
**E2E smoke script:** `scripts/smoke-kanban-slice.sh`

---

## Summary

Refactored AIHub's project management from a **project-as-kanban-unit** model to a **slice-as-kanban-unit** model per Shape Up principles. Projects become containers with a lifecycle (`shaping → active → done / cancelled`); slices are the independently finishable scopes that move through the kanban (`todo → in_progress → review → ready_to_merge → done`). The orchestrator was rekeyed from `projectId` to `sliceId`.

---

## Issues delivered (01–15)

| # | Title | Key changes |
|---|-------|-------------|
| 01 | Slice storage primitives | `packages/extensions/projects/src/projects/slices.ts` — `createSlice`, `getSlice`, `updateSlice`, `listSlices`; per-project counter at `.meta/counters.json`; atomic frontmatter writes; ID format `PRO-XXX-Snn` |
| 02 | CLI `aihub slices add/list/get` | `packages/extensions/projects/src/cli/slices.ts` — `add`, `list`, `get` commands registered under `aihub slices` in `apps/gateway/src/cli/index.ts` |
| 03 | SCOPE_MAP generator | `packages/extensions/projects/src/projects/slices.ts` — `generateScopeMap()` regenerates `SCOPE_MAP.md` atomically on every mutation; header warns "do not edit by hand" |
| 04 | CLI `aihub slices move/rename/comment/cancel` | Mutation verbs added; every mutation triggers SCOPE_MAP regen; invalid status exits non-zero |
| 05 | Project status refactor + cascade | New project lifecycle enum `shaping \| active \| done \| cancelled`; auto-done when all child slices terminal and ≥1 done; cancellation cascade flips non-terminal slices |
| 06 | `aihub projects migrate-to-slices` | Idempotent migration: wraps legacy SPECS/TASKS/VALIDATION into `slices/PRO-XXX-S01/`; maps legacy statuses per spec §10.1; `not_now`/`maybe` → `shaping` without slice; refuses to run with gateway detected |
| 07 | SubagentRun schema `sliceId`/`projectId` | `packages/shared/src/types.ts` gains optional `sliceId` + `projectId`; `isActiveOrchestratorRun` filters by `sliceId` with cwd fallback; `OrchestratorAttemptTracker` keyed by `sliceId` |
| 08 | Dispatcher + Worker rekey | `packages/extensions/projects/src/orchestrator/dispatcher.ts` — enumerate slices, filter by parent `active`, dedupe by `sliceId`, dispatch; Worker prompt reads pitch + SCOPE_MAP + slice docs; worktree path `<worktreeDir>/<PRO-XXX>/<PRO-XXX-Snn>-<slug>/` |
| 09 | Reviewer rekey | `workerWorkspaces` lookup filters by `sliceId`; pass → `review → ready_to_merge`; fail → `review → todo` + gap comment in slice THREAD.md |
| 10 | SliceKanbanWidget + SliceDetailPage | `apps/web/src/components/SliceKanbanWidget.tsx`, `SliceDetailPage.tsx`; 6 columns per-project; drag-to-move; nested route `/projects/:projectId/slices/:sliceId`; flat route redirects |
| 11 | Board ext — project list grouped | `apps/web/src/components/board/ProjectListGrouped.tsx`; groups: active/shaping (expanded), done/cancelled (collapsed); search + area filter chips; drag-to-change-lifecycle-status |
| 12 | Board ext — project detail (4 tabs) | `apps/web/src/components/board/BoardProjectDetailPage.tsx`; tabs: Pitch/Slices/Thread/Activity; `SliceKanbanWidget` embedded in Slices tab; WYSIWYG editor for Pitch + Thread |
| 13 | Board ext — agents view + kill | `apps/web/src/components/board/AgentsView.tsx`; live runs grouped by project; `sliceId` shown per row; kill action sends SIGTERM |
| 14 | Board ext — activity feed | Stateless aggregator; project + slice status transitions + run lifecycle + thread entries; newest-first; capped at 100 entries |
| 15 | Docs + E2E smoke | This document; `docs/llms.md` updated; `scripts/smoke-kanban-slice.sh` written and passing |

---

## Key architectural decisions

### Slices as kanban unit

The kanban (`todo → in_progress → review → ready_to_merge → done`) is scoped to slices. Projects show lifecycle only (`shaping → active → done`). This matches Shape Up: a project is a bet; a slice is an independently finishable scope.

### Project gate

The orchestrator only dispatches slices whose parent project is `active`. Slices in `todo` under a `shaping` project are visible on the board but never auto-dispatched — they wait for human promotion of the project.

### `extensions.projects.orchestrator` config key (historical artifact)

Config key stays at `extensions.projects.orchestrator` for backward compat. The dispatcher now operates on slices, not projects. This inconsistency is intentional and documented in `docs/llms.md`.

### Cooldown + dedupe by `sliceId`

`OrchestratorAttemptTracker` and `isActiveOrchestratorRun` are keyed by `sliceId`. One failing slice does not block sibling slices.

### Legacy run attribution

Existing `SubagentRun` state files are untouched. Pre-slice runs surface in the agents view with a "pre-slice run" indicator (no `sliceId`). New runs always populate both `projectId` and `sliceId`.

### `ProjectsBoard` legacy component

`ProjectsBoard.tsx` still co-exists with the new board extension components (`ProjectListGrouped`, `BoardProjectDetailPage`, `AgentsView`) during migration. Full removal tracked as a follow-up; the new components are the canonical surface.

---

## Data model summary

### Project filesystem layout (post-refactor)

```
$AIHUB_HOME/projects/<PRO-XXX>/
  README.md              # pitch (frontmatter: id, title, status, area, ...)
  THREAD.md              # project-level discussion
  SCOPE_MAP.md           # auto-generated slice index (do not edit by hand)
  .meta/
    counters.json        # { lastSliceId: <int> }
  slices/
    <PRO-XXX-Snn>/
      README.md          # frontmatter: id, project_id, title, status, hill_position, ...
      SPECS.md
      TASKS.md
      VALIDATION.md
      THREAD.md
```

### Project lifecycle statuses

```
shaping → active → done
                 ↘ cancelled
```

### Slice kanban statuses

```
todo → in_progress → review → ready_to_merge → done
                                              ↘ cancelled
```

---

## CLI surface

```bash
# Slice operations (filesystem-local, no gateway required)
aihub slices add --project <PRO-XXX> "<title>"
aihub slices list [--project <id>] [--status <s>]
aihub slices get <sliceId>
aihub slices move <sliceId> <status>
aihub slices rename <sliceId> "<title>"
aihub slices comment <sliceId> "<body>"
aihub slices cancel <sliceId>

# Migration (stop gateway first)
aihub projects migrate-to-slices
```

---

## Test commands

All pass on this branch:

```bash
pnpm test:cli       # 48 tests
pnpm test:gateway   # 171 tests
pnpm test:shared    # 47 tests
pnpm test:web       # 246 tests
```

---

## E2E smoke script

```bash
# From repo root. Creates a temp AIHUB_HOME, runs vitest suites + CLI integration assertions.
bash scripts/smoke-kanban-slice.sh

# Preserve home after run for inspection:
KEEP_HOME=1 bash scripts/smoke-kanban-slice.sh
```

Script covers:
- All four vitest suites (AIHUB_HOME unset to avoid test isolation issues)
- Slice creation, filesystem layout assertions (#01)
- Slice frontmatter read (#02)
- SCOPE_MAP regeneration on rename + move (#03)
- Status mutation cycle `in_progress → review → ready_to_merge` (#04)
- Invalid status rejected (#04)
- Comment append (#04)
- Cancel cascade (cancel command) (#05)
- SCOPE_MAP shows `done` for completed slice (#05)
- SCOPE_MAP shows `ready_to_merge` (not premature done) (#05)
- `migrate-to-slices` CLI command exists (#06)
- New board extension components present (#11–#14)

### Worker/Reviewer orchestrator dispatch (manual)

Full dispatch requires a running gateway + configured profiles. The smoke script prints the manual procedure at the end. Key steps:

1. Configure `extensions.projects.orchestrator` with Worker + Reviewer profiles
2. Create project dir + slice, start gateway
3. Poll until Worker dispatches: `aihub slices get <SLICE_ID> | grep in_progress`
4. Assert `sliceId` + `projectId` on Worker run: `aihub subagents list --json | jq '...'`
5. Reviewer pass → `ready_to_merge`; project stays `active`
6. Manual merge + `aihub slices move <id> done` → project auto-done

---

## Caveats / known gaps

| Item | Status |
|------|--------|
| `ProjectsBoard` legacy component | Still in web app alongside new board ext components. Follow-up cleanup. |
| Worker/Reviewer live LLM dispatch | Not tested in CI smoke (requires gateway + profiles). Manual procedure documented. |
| Cancellation via gateway `project update` | Tested via unit tests; slice `cancel` command tested in smoke. Gateway cascade tested in `store.test.ts`. |
| Hill chart UI | `hill_position` field reserved in schema; no UI yet. |
| v0.4 reliability work | Reconciliation, exponential-backoff retries, stall detection parked. |
| SCOPE_MAP concurrent writes | Uses atomic temp-rename; noted in spec as acceptable. |
