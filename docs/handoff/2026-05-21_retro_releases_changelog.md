# Retro releases + changelog

## Summary
- Created root `CHANGELOG.md` with retro release notes in latest-first order (`v0.11.0` → `v0.1.0`).
- Tags are product-history milestones, not npm package versions.
- Created and pushed annotated tags `v0.1.0` through `v0.11.0`.
- Created matching GitHub releases. `v0.11.0` is marked latest.

## Release ladder
- `v0.1.0` → `b578ffb` — Initial gateway foundation
- `v0.2.0` → `57171b1` — Projects + subagent loop
- `v0.3.0` → `d02b2a1` — Project UI, Space, and worktree workflow
- `v0.4.0` → `3bd77b3` — Components, auth, containers, media
- `v0.5.0` → `8d06f21` — Extension extraction
- `v0.6.0` → `336a4b4` — Board, scratchpad, runtime subagents
- `v0.7.0` → `8d882f4` — Slices + orchestrator reliability
- `v0.8.0` → `b6f9106` — Architecture refactor stabilization
- `v0.9.0` → `41220f2` — Scheduler/auth polish after refactor
- `v0.10.0` → `d83b06c` — Decentralized agent + scheduler config
- `v0.11.0` → `1519f10` — Current reliability + admin/media polish

## Notes
- Dedicated `v0.10.0` release captures config decentralization: per-agent `agent.yaml` and scheduler `cron/jobs.json`.
- `CHANGELOG.md` is currently uncommitted; commit it when ready.
