# Slice Blocking UI

PRO-241-S02 added the board UI surfaces for slice blockers.

- `SliceDetailPage` shows a left-sidebar Blockers section when `frontmatter.blocked_by` has entries. Rows link to each blocker slice and resolve title/status through `/api/projects/:id/slices`, including cross-project IDs parsed from `PRO-XXX-Snn`.
- `SliceKanbanWidget` marks cards blocked only when at least one blocker is unresolved or non-terminal. Terminal blocker statuses are `done`, `ready_to_merge`, and `cancelled`.
- Missing blocker IDs display as unknown in the detail sidebar and stay active blockers in the Kanban badge, matching S01 dispatcher behavior.
- Added web component tests for visible/hidden sidebar blockers and Kanban active/terminal blocker badge behavior.
