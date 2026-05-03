---
title: `board` ext — Activity feed
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md (§15.5)
---

## What to build

Stateless activity feed aggregator. No new persistence.

Inputs:
- Project frontmatter `updated_at` + `status` transitions (latest only in v1).
- Slice frontmatter `updated_at` + `status` transitions.
- Subagent run state.json: `started_at`, `completed_at`, exit status, profile, sliceId.
- Project + slice `THREAD.md` entries (parsed with timestamps).

Output: chronological list, newest first.

Scope:
- Board-home feed: cross-project, top ~50 entries.
- Project-detail Activity tab: scoped to that project + all its slices + their runs.

Item shape:

```
2m ago   Worker run completed     PRO-238-S03   [view run]
5m ago   PRO-201-S01 → review     manual move
12m ago  PRO-238 → active         status change
```

Implementation: aggregate on each request, cache briefly. Cap 100 entries per request. Skip projects fully collapsed in dashboard view.

## Acceptance criteria

- [ ] Backend endpoint(s) return chronological feed for cross-project + per-project scopes
- [ ] Items cover: project status transitions, slice status transitions, run start/complete, thread comments
- [ ] Cap at 100 entries per request
- [ ] Brief in-memory cache so repeated requests don't re-walk disk
- [ ] Frontend renders the feed in board-home + project Activity tab
- [ ] Tests: aggregation correctness, cap, cache, item formatting
- [ ] Performance budget §15.7 not regressed
- [ ] `pnpm test:web` + `pnpm test:gateway` pass

## Blocked by

- #5 Project status refactor
- #7 SubagentRun schema
