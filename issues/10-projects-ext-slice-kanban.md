---
title: `projects` ext — SliceKanbanWidget + SliceDetailPage
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md (§7.1)
---

## What to build

Slice UI in the `projects` extension. Removes the existing project kanban view (slices replace it as kanban unit).

- `SliceKanbanWidget` — props: `projectId`. Columns: `todo | in_progress | review | ready_to_merge | done | cancelled`. Always live (no realtime suspension). Per-project scope only (no cross-project view).
- `SliceDetailPage` — full slice card view (specs, tasks, validation, thread, runs).
- Routes:
  - `/projects/:projectId/slices/:sliceId` — slice detail (canonical, nested).
  - Optional flat `/slices/:sliceId` — 302 to canonical nested URL.
- Drag-to-move triggers slice status change via existing CLI/API (#4).
- Remove old project kanban view + its routes.

## Acceptance criteria

- [ ] `SliceKanbanWidget` renders all six columns scoped to a single `projectId`
- [ ] Drag a card → status change persists; widget updates from realtime feed
- [ ] `SliceDetailPage` renders frontmatter + Specs + Tasks + Validation + Thread + recent runs
- [ ] Nested route works; flat route 302s to nested
- [ ] Old project kanban component + routes deleted (no dead code left)
- [ ] Component tests cover render + drag → status change
- [ ] `pnpm test:web` passes

## Blocked by

- #1 Slice storage primitives
- #4 CLI / API for slice mutations
