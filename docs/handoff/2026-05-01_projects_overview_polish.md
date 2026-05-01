# Projects Overview Polish

- Updated Board tab `ProjectsOverview` list rows: title/count on top, area/status on bottom.
- Renamed the README preview section heading to `README / SPECS`.
- Board tab README/SPECS Edit now renders the existing `ProjectDetailPanel` inline in the overview right pane. It pushes a same-URL history entry so browser Back closes the editor without remounting the project list. Open diff still uses the Board detail panel.
- Board project scan now dedupes Space queue worktrees by canonical `worktreePath`, keeping the newest `createdAt` entry and falling back to later queue order when dates are not comparable.
- Added focused tests for worktree dedupe and inline editor/back behavior.
