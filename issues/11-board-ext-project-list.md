---
title: `board` ext — project list grouped by lifecycle + drag-to-move
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md (§15.2)
---

## What to build

Board home: flat list of projects grouped by lifecycle status, with search, area filter chips, and drag-to-change-status.

Group order:
1. `active` (expanded by default)
2. `shaping` (expanded by default)
3. `done` (collapsed by default — header `done (N) [show]`)
4. `cancelled` (collapsed by default)

`archived` not shown on board home (existing semantics retained).

Top-of-page controls:
- Search box: title + ID full-text match.
- Area filter chips from `/board/areas`. Click to filter list.

Card content (per §15.2):
- Line 1: `PRO-XXX  [status pill]  area:<name>`
- Line 2: project title
- Line 3: progress bar `n/m slices done` + active run dot if any
- Line 4: `updated <relative> by <actor>`

Interactions:
- Click → `/projects/:projectId` detail page (#12).
- Drag between status sections → `POST /board/projects/:id/move`. Allow any target; backend validates per §5.4. On reject, toast with reason. Optimistic UI with revert on reject.

States: empty (`"No projects yet"` + Create CTA), error (`"Failed to load projects"` + Retry), loading (skeleton rows, 3 per visible group).

Backend:
- Extend `GET /board/projects` to include lifecycle status, slice progress (`n/m done`), last activity, active run count, area.
- Add `POST /board/projects/:id/move` with structured rejection on invalid transitions.

## Acceptance criteria

- [ ] List grouped by `active | shaping | done | cancelled`; `archived` omitted; counts visible in headers
- [ ] `done` and `cancelled` groups collapsed by default; toggle works
- [ ] Search filters by title + ID
- [ ] Area chips filter the list; "All" resets
- [ ] Card displays status pill, area chip, progress (`n/m slices done`), active run dot, last-activity line
- [ ] Drag-to-move: optimistic update; rejected transitions toast with the backend error and revert
- [ ] Backend `POST /board/projects/:id/move` validates transitions per §5.4 and returns structured error on reject
- [ ] Empty / error / loading states styled per spec
- [ ] Tests: backend endpoint (validation + reject) + frontend (group rendering, drag, error toast)
- [ ] `pnpm test:web` + `pnpm test:gateway` pass

## Blocked by

- #5 Project status refactor
