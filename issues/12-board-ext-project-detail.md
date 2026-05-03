---
title: `board` ext — project detail page (4 tabs)
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md (§15.3)
---

## What to build

`/projects/:projectId` page hosted by `board` ext. Header shows ID, title, status pill, area, lifecycle action menu (`Move to active`, `Cancel`, `Archive`, `Unarchive`).

Tabs:

| Tab | Content |
|-----|---------|
| Pitch | `README.md` rendered + edited via existing `DocEditor` (Tiptap WYSIWYG). Inline save. |
| Slices | `SliceKanbanWidget` from `projects` ext (#10), scoped to this project. Columns per §5.4. `[+ Add slice]` button at top. |
| Thread | `THREAD.md` via `DocEditor` + comment-append form. |
| Activity | Project-scoped activity feed (#14). |

Behavior:
- No edit lock; concurrent edits during orchestrator runs allowed (Worker reads at dispatch time).
- Slice creation entry only from Slices tab (mirrors CLI `slices add --project`).
- Realtime live across all tabs, including with WYSIWYG focused (last-write-wins, accepted per §15.6).

## Acceptance criteria

- [ ] Header shows ID, title, status pill, area, lifecycle action menu with valid transitions only
- [ ] Pitch tab: WYSIWYG editor reads/writes project `README.md`; inline save
- [ ] Slices tab: embeds `SliceKanbanWidget(projectId)` and `[+ Add slice]` opens creation flow
- [ ] Thread tab: WYSIWYG view of THREAD.md + comment-append form
- [ ] Activity tab: project-scoped feed (depends on #14, may stub if #14 not yet merged)
- [ ] Realtime updates flow without suspension while editor focused
- [ ] Tests: tab navigation, save flow, slice creation entry
- [ ] `pnpm test:web` passes

## Blocked by

- #5 Project status refactor
- #10 `projects` ext SliceKanbanWidget
