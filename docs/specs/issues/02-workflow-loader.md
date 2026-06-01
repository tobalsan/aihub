---
title: "Orchestrator slice 02: WorkflowLoader (global + per-repo merge, placeholders, hot-reload)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Add `WorkflowLoader` so the daemon resolves a per-repo `WORKFLOW.md` at the repo root and falls back to `$AIHUB_HOME/WORKFLOW.md` for no-repo issues and repos without a local workflow. YAML frontmatter merges per field (per-repo wins); markdown body is replaced wholesale. Render placeholders (`{{issue.*}}`, `{{repo.*}}`, `{{run.*}}`) at claim time with simple string substitution (no template engine). Hot-reload via `chokidar`: changes invalidate the mtime cache and emit `orchestrator.workflow.changed` over the existing WebSocket bus. Active runs keep their original snapshot (`workflow_path` + `workflow_sha` carried in run state) so in-flight work is not corrupted.

Frontmatter exposes the state vocabulary (`tracker.states.active`, `tracker.states.terminal`, `tracker.states.needs_human`, `tracker.states.in_progress_target`), `polling.{interval_ms,jitter_ms}`, `workspace` placeholders for later slices, `agent.{profile,max_turns,stall_timeout_ms}`, hook command strings (no-ops in this slice), `server.notify_channel`, and `linear.{expose_graphql_tool, attach_issue_url}`. Ship a default `$AIHUB_HOME/WORKFLOW.md` with the "linear skill" prompt section teaching the agent common GraphQL ops via the existing tool.

This slice also adds the read-only `GET /api/orchestrator/workflow?repo=<name>` route and the `aihub orchestrator workflow [--repo NAME]` CLI verb so the merged frontmatter can be inspected.

## Acceptance criteria

- [ ] `WorkflowLoader.resolve({ repo? })` returns the merged frontmatter object + rendered body string for a given issue context.
- [ ] Per-repo `WORKFLOW.md` overrides global frontmatter field-by-field; body is replaced wholesale.
- [ ] Placeholders `{{issue.identifier|title|description|url|state|labels|parentId|projectName}}`, `{{repo.name|path|baseBranch}}`, `{{run.id|branch|workspace|turn}}` substitute correctly; missing values render as empty strings, not the literal `{{...}}`.
- [ ] State vocabulary read from `tracker.states.*` drives the existing poll query (no hardcoded names left in the dispatcher).
- [ ] chokidar watcher invalidates the mtime cache on change and emits `orchestrator.workflow.changed` over WS within ~1 s of save.
- [ ] In-flight runs ignore the change: they keep their pre-claim `workflow_path` + `workflow_sha`; only the next dispatch picks up the new version.
- [ ] `$AIHUB_HOME/WORKFLOW.md` template is created on first run if absent and ships with a "linear skill" prompt section.
- [ ] `GET /api/orchestrator/workflow?repo=<name>` returns the merged frontmatter; omitting `repo` returns the fallback.
- [ ] `aihub orchestrator workflow --repo aihub` prints the merged frontmatter; per-repo override visibly takes precedence in the output.

## Blocked by

- Slice 01 (tracer E2E loop).
