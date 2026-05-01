# Worktree Subagent Runs Panel

- Added canonical `cwd` filtering to runtime subagent listing. `/api/subagents?cwd=...` expands `~`, resolves real paths when possible, and still honors `includeArchived`.
- Added `SubagentRunsPanel` for cwd-scoped runtime run lists with lazy log fetching, chat-style monitor history, refresh, stop, archive, and delete controls.
- Updated `ProjectsOverview` worktree rows to use a local chevron expansion state and removed the misleading `Open diff` action plus old inline Logs/Stop/Resume modal code.
- Added backend cwd filter tests and frontend smoke coverage for panel rendering plus lazy log expansion.
