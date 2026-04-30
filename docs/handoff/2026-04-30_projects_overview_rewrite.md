# Projects Overview Rewrite

## Summary

- Replaced the old kanban-oriented `ProjectsBoard` route with `ProjectsOverview`.
- `/projects` and `/projects/:id` now show a two-pane overview: list/filter/search on the left, selected project detail/worktrees on the right.
- The existing `ProjectDetailPage` remains the deep editor and opens as an overlay when the overview sets `?detail=1`.
- Removed the Agent Monitor tab/panel from `BoardView`; scratchpad and projects canvas remain.

## Verification

- `pnpm test:web`

