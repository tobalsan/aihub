---
title: `board` ext — `/board/agents` view + kill action
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md (§15.4)
---

## What to build

Live runs view at `/board/agents`. Sections grouped by project. Within each section, rows for live runs (Worker / Reviewer / manual subagent runs).

Layout:

```
PRO-238  Auth refactor
  Worker     PRO-238-S03  started 2m ago  [view] [kill]
PRO-201  Mobile app
  Reviewer   PRO-201-S01  started 5m ago  [view] [kill]
```

Run row columns: profile, slice ID, started-at, action buttons.

Actions:
- `[view]` → existing subagent run detail page.
- `[kill]` → confirmation dialog (`"Kill <profile> on <slice>?"`), then `POST /board/agents/:runId/kill`. Sends SIGTERM via existing run state. Best-effort until v0.4 reconciler.

Empty state: `"No live runs."`

Backend:
- `GET /board/agents` returns live orchestrator + manual subagent runs grouped/groupable by project.
- `POST /board/agents/:runId/kill` sends SIGTERM, marks run state, returns success.

## Acceptance criteria

- [ ] View groups live runs by project; legacy runs without `sliceId` still surface (e.g. badge)
- [ ] `[view]` links to existing run detail page
- [ ] `[kill]` opens confirmation; on confirm, calls backend; row disappears once exit detected
- [ ] Realtime updates as runs start/complete
- [ ] Backend kill endpoint sends SIGTERM and is idempotent on already-exited runs
- [ ] Empty state rendered when no live runs
- [ ] Tests: backend kill endpoint + frontend grouping + confirm-then-kill flow
- [ ] `pnpm test:web` + `pnpm test:gateway` pass

## Blocked by

- #7 SubagentRun schema (`sliceId` for grouping)
