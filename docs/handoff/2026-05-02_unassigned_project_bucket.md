# Unassigned Project Bucket

Implemented the Board Projects `__unassigned` pseudo-project.

- Backend board scan now keeps git worktrees that fail project attribution and appends a synthetic read-only project with `status: "unassigned"`.
- Projects overview pins `Unassigned` at the bottom regardless of filters/search, hides save/status actions, and keeps normal worktree expansion behavior.
- `SubagentRunsPanel` can render an unassigned mode: fetch all runtime subagents, keep active runs only, and exclude runs whose `cwd` matches real project worktrees.
- Focused tests cover backend attribution, frontend read-only rendering, and unassigned run filtering.

