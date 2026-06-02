---
title: "Orchestrator slice 03: Project workspace layout"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-symphony-alignment-prd.md
---

## Parent

`docs/specs/orchestrator-symphony-alignment-prd.md` — Symphony-aligned project-scoped orchestrator.

## What to build

Directory-only per-issue workspaces for configured projects. Each project supplies `WORKFLOW.md`; `workspace.root` resolves relative to that project folder and defaults to `./workspaces`. `WorkspaceLayout` sanitizes the Linear identifier and creates `<workspace.root>/<sanitized-identifier>/` as a plain directory. Core orchestration does not clone repos, create git worktrees, delete branches, or route by labels.

Repo bootstrap, if needed, belongs in deterministic hooks/tooling or prompt instructions that keep all filesystem writes inside the issue workspace.

## Acceptance criteria

- [ ] `WorkspaceLayout.create({ identifier })` creates a plain directory under workflow `workspace.root` and returns `{ path, created }`.
- [ ] Re-creating a workspace for the same identifier is idempotent and returns `created: false`.
- [ ] `WorkspaceLayout.remove({ identifier })` removes only the per-issue directory and refuses paths escaping the workspace root.
- [ ] No git command is invoked by core workspace layout.
- [ ] Dispatcher passes the resolved issue workspace path to the `subagents` run as `cwd`.
- [ ] Smoke: a Linear issue in a configured project creates `$PROJECT/workspaces/<id>/` unless workflow `workspace.root` overrides it.

## Blocked by

Slice 02 workflow loading and project registry.
