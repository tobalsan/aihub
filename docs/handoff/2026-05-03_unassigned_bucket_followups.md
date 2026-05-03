# Unassigned Bucket Follow-ups

## Summary

Fixed two Board Projects unassigned-bucket follow-ups:

- The unassigned detail panel now excludes worktree paths from every board project, including `__unassigned`, so a run whose `cwd` matches an unassigned worktree is not duplicated in the top "Active runs not tied to a worktree" panel.
- `ProjectsOverview` now subscribes to `subagent_changed` websocket events via `subscribeToSubagentChanges` and debounces board project refetches with the same 250ms path used for file/agent changes.

## Verification

- `pnpm exec vitest run apps/web/src/components/ProjectsOverview.test.tsx`
- `pnpm exec vitest run apps/web/src/components/ProjectsOverview.test.tsx apps/web/src/components/BoardView.test.tsx`
- `pnpm test`
