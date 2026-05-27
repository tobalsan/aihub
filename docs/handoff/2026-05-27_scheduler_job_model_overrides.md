# Scheduler job model overrides

Implemented optional scheduler job `model: { provider, model }` overrides.

Changes:
- Scheduler job/create/update schemas accept top-level `model` with both fields required.
- Scheduler service persists job model, passes it into `runAgent`, and records effective model in cron output files.
- Native run contract and SDK run params carry optional per-run model override.
- Pi adapter resolves override before agent default.
- Container input builder serializes override into `sdkConfig.model`.
- CLI supports `--provider` + `--model` on scheduler add/update.
- Docs updated in README, scheduler README, and `docs/llms.md`.

Validation:
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run packages/extensions/scheduler/src/store.test.ts packages/extensions/scheduler/src/output.test.ts packages/extensions/scheduler/src/cli/index.test.ts apps/gateway/src/sdk/container/input-builder.test.ts`
- `pnpm test:shared`
- `pnpm test:gateway`
- `pnpm exec vitest run --dir packages/extensions/scheduler/src`
