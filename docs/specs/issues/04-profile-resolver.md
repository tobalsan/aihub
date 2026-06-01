---
title: "Orchestrator slice 04: ProfileResolver (default + label-to-profile mapping)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

`ProfileResolver` chooses which `extensions.subagents.profiles[]` entry to use for a given issue. WORKFLOW frontmatter exposes `agent.default_profile` and an optional `agent.label_profiles` map (`{ "agent:claude": "claude-default", "agent:codex": "codex-default" }`). Resolution rules: if exactly one Linear label maps to a configured profile, use it; if zero map, use the default; if more than one maps, park the issue in `Needs Human` with a comment via `linear_graphql` explaining the ambiguity; if a mapped profile name is missing from `extensions.subagents.profiles[]`, park in `Needs Human`.

This slice wires the resolver into the dispatch path so profile selection comes from the workflow + labels, not a hardcoded default.

## Acceptance criteria

- [ ] `ProfileResolver.resolve({ labels, workflow, profilesConfig })` returns either `{ profile }` or `{ park: { reason } }`.
- [ ] Pure-function table tests cover: default-only, single matching label, multiple matching labels → park, missing mapped profile → park, label maps to default name explicitly.
- [ ] Park outcome causes the dispatcher to: post a Linear comment via `linear_graphql` describing the reason, set the issue state to `Needs Human`, and release the claim without starting a worker.
- [ ] Successful resolution flows the selected profile into the `subagents` run start call.
- [ ] Smoke: with `agent.label_profiles: { "agent:codex": "codex-default", "agent:claude": "claude-default" }` configured, an issue with `agent:claude` runs with the `claude-default` profile; an issue with both `agent:codex` and `agent:claude` is parked in `Needs Human` with an explanatory comment.

## Blocked by

- Slice 02 (WorkflowLoader).
