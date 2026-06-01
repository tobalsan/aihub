---
title: "Orchestrator slice 08: CLI verbs (aihub orchestrator …)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Commander-based CLI subcommands exposed by the orchestrator extension under `aihub orchestrator <verb>`. Verbs: `status` (daemon heartbeat + active claims + next-tick countdown), `claim <id>`, `release <id>`, `interrupt <id>`, `kill <id>`, `logs <id> [--since N] [--follow]` (streams worker stdout via the HTTP route from slice 07), `runs [--issue ID] [--limit N]`, `events <runId>`, `workflow [--repo NAME]` (overlaps with slice 02 — keep the existing implementation, just hang it off this command surface), `export [--team KEY] [--out DIR]` (stubs to slice 13), and `tick` (debug: forces a single poll cycle).

All commands talk to the gateway over the local HTTP API — no direct daemon imports — so the CLI works the same when the gateway runs on the Mac Studio and the CLI runs on the MBP.

## Acceptance criteria

- [ ] `aihub orchestrator status` prints heartbeat info + active claim count + next-tick ETA + rate-limit remaining.
- [ ] `aihub orchestrator claim <id>` / `release <id>` / `interrupt <id>` / `kill <id>` map to the corresponding `POST` routes; exit codes reflect 2xx / 4xx.
- [ ] `aihub orchestrator logs <id> --follow` streams stdout until SIGINT.
- [ ] `aihub orchestrator runs --limit 20` returns a table; `--issue ENG-NN` filters to that issue.
- [ ] `aihub orchestrator events <runId>` paginates through the SQLite events for the run.
- [ ] `aihub orchestrator workflow --repo aihub` returns the merged frontmatter (delegates to slice 02).
- [ ] `aihub orchestrator tick` triggers a single poll cycle and prints the dispatched/skipped counts.

## Blocked by

- Slice 07 (HTTP routes).
