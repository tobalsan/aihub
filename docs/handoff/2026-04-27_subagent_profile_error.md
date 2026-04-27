# 2026-04-27 Subagent Profile Error

## Update

- Runtime subagent `POST /api/subagents` now returns `Unknown subagent profile: <name>` when `--profile` does not match a configured runtime profile.
- The error includes available profile names when present, preventing unknown profiles from falling through to `cli must be codex, claude, or pi`.
- Added regression coverage in `packages/extensions/subagents/src/index.test.ts`.
