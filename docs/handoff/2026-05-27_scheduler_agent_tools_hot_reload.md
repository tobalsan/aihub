# Scheduler agent tools and hot reload

Implemented scheduler agent tools and MVP hot reload from `docs/specs/scheduler-agent-tools-prd.md`.

Changes:
- Scheduler extension injects self-only tools when scheduler is enabled:
  - `scheduler.list_jobs`
  - `scheduler.create_job`
  - `scheduler.update_job`
  - `scheduler.delete_job`
  - `scheduler.get_latest_output`
- Tool-created jobs use scheduler-generated ids and are enabled by default.
- Tools support raw cron/tz/startAt, message, and optional sessionId.
- Tools do not expose model overrides.
- Expected validation/not-found failures return `{ ok: false, error }`.
- Latest output returns bounded content preview.
- Scheduler service can refresh jobs from disk.
- Gateway starts a 5s mtime polling hot reload loop for config, agent YAML, and cron job files.
- Extension context now reads current config dynamically.
- Docs updated in README, scheduler README, and docs/llms.md.

Validation:
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run --dir packages/extensions/scheduler/src`
- `pnpm test:shared`
- `pnpm test:gateway`
