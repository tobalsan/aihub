---
title: "Orchestrator slice 13: Exporter (one-way Linear → markdown)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

A one-way Linear → markdown snapshot tool for backup and grep. Triggered by `POST /api/orchestrator/export[?team=KEY]` or `aihub orchestrator export [--team KEY] [--out DIR]`. Writes one file per issue at `$AIHUB_HOME/exports/linear/<TEAM>-<NUM>.md` (or the supplied `--out` dir) with YAML frontmatter containing the structured Linear fields (id, identifier, state, labels, project, parent, assignee, timestamps) and a markdown body containing the issue description followed by ordered comments.

No reverse import. No edit detection. Re-running overwrites existing files atomically (write to a temp file in the same directory, then rename).

## Acceptance criteria

- [ ] `POST /api/orchestrator/export` runs the exporter for the configured team; `?team=KEY` overrides; returns a summary `{ exported, skipped, durationMs }`.
- [ ] `aihub orchestrator export --team ENG --out /tmp/snap` writes files under the given directory.
- [ ] Per-issue file is `<TEAM>-<NUM>.md` with structured frontmatter + description + ordered comments.
- [ ] Re-running over an existing export directory is atomic (no partial files on crash).
- [ ] Output respects the Linear rate-limit bucket from slice 01.
- [ ] Smoke: export a team with ≥10 issues; spot-check that one file contains the issue's full comment thread in chronological order.

## Blocked by

- Slice 01 (tracer E2E loop).
