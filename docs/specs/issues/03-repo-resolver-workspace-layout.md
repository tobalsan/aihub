---
title: "Orchestrator slice 03: RepoResolver + WorkspaceLayout (git worktree + no-repo fallback)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Repo-aware workspaces. `RepoResolver` is a pure function over `(labels, config)` returning `{ name, path, baseBranch }`, `null` (no-repo), or `{ name, warning }` for multi-repo (pick first `repo:*` label alphabetically + emit warning event). `WorkspaceLayout` sanitizes the Linear identifier (strip non-`[A-Za-z0-9_-]`, lowercase), creates a git worktree at `extensions.orchestrator.workspacesRoot` (default `$AIHUB_HOME/workspaces/<sanitized-identifier>/`) on branch `aihub/<sanitized-identifier>` from the resolved `baseBranch`, and tears it down on terminal when `workspace.cleanup_on_terminal=true`. Worktrees survive across runs by default (`workspace.reuse: true`). Issues with no `repo:*` label keep using no-repo mode (plain `mkdir -p`).

The orchestrator dispatch path now: resolve repo → prepare workspace → start the `subagents` run with the workspace path as `cwd`. Concurrent issues against the same repo each get their own worktree on their own branch; no leases needed.

## Acceptance criteria

- [ ] `RepoResolver` table-tested over (labels, config) inputs covering: matching `repo:<name>` label, no label + `defaultRepo` set, no label + no default (no-repo), multiple `repo:*` labels (first alphabetical + warning), label missing from config (warning, no-repo).
- [ ] Identifier sanitizer strips characters outside `[A-Za-z0-9_-]` and lowercases the result (table-tested).
- [ ] `WorkspaceLayout.create({ identifier, repo, baseBranch })` runs `git worktree add -b aihub/<sanitized-id> <workspaceDir> <baseBranch>` and returns the workspace path.
- [ ] Re-creating a workspace for the same identifier is idempotent (reuses the existing worktree when present).
- [ ] `WorkspaceLayout.remove({ identifier })` removes the worktree and deletes the branch; succeeds even when the worktree is already gone.
- [ ] No-repo mode produces a plain directory with no `.git`.
- [ ] Dispatcher passes the resolved workspace path to the `subagents` run as `cwd`.
- [ ] Smoke: a Linear issue labeled `repo:aihub` in `Ready` produces a worktree at `$AIHUB_HOME/workspaces/<id>/` checked out on `aihub/<id>`; `git -C ~/code/aihub worktree list` shows it; agent commits land on that branch.

## Blocked by

- Slice 02 (WorkflowLoader).
