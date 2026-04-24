# 2026-04-24 Subagents Runtime Extension

Implemented the first project-agnostic subagents runtime on the `codex/subagents-runtime-extension` worktree, branched from `board`.

Changes:

- Added default-enabled `@aihub/extension-subagents`.
- Added `/api/subagents` runtime routes for start/list/get/resume/interrupt/archive/unarchive/delete/logs.
- Added global run storage under `$AIHUB_HOME/sessions/subagents/runs/<runId>`.
- Added `subagent_changed` websocket broadcasts.
- Added `aihub subagents ...` CLI commands backed by gateway HTTP.
- Added shared runtime config/types for `extensions.subagents.profiles`.
- Wired Board monitor pane to list runtime subagents, show status/latest output, refresh on websocket events, and interrupt active runs.
- Updated the spec with Board overview requirements and `latestOutput`.

Validation:

- `pnpm build`
- `pnpm build:web`
- `pnpm test:shared`
- `pnpm test:gateway`
- `pnpm test:web`
- `pnpm exec vitest run apps/gateway/src/cli/subagent.test.ts`

Notes:

- Legacy project-owned subagent routes still exist for current project UI compatibility.
- The new runtime is independent and available to Board/other extensions through `/api/subagents`.
