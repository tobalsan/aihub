# pnpm dev respects scheduler/heartbeat config

## Problem

`pnpm dev` printed `Scheduler/Heartbeat: OFF` in the dev banner regardless of the
provided config. The banner was hardcoded text (`apps/gateway/src/cli/index.ts`),
left over from commit `ba80035` where `--dev` originally skipped
`startScheduler()` / `startAllHeartbeats()`. After the extension-system refactor
that explicit gating was lost; instead both extensions were force-loaded by being
listed in `BUILT_IN_DEFAULTS` inside `apps/gateway/src/extensions/registry.ts`,
so they ran even without any config entry — while the banner still lied about it.

## Fix

- Removed `BUILT_IN_DEFAULTS` from `registry.ts`. All built-ins now follow the
  same rule as third-party extensions: load only when `extensions.<id>` is
  present in `aihub.json`. To keep using the scheduler, set
  `extensions.scheduler: {}` (or with explicit settings). Same for `heartbeat`.
- `printDevBanner` in `apps/gateway/src/cli/index.ts` now receives the loaded
  `Extension[]` and prints `Scheduler: ON|OFF  Heartbeat: ON|OFF` based on what
  actually loaded, in both `pnpm dev` and standalone `--dev` paths.

## Behavior

- Default (no `extensions.scheduler` / `extensions.heartbeat` in config): both
  OFF — neither extension is constructed and no routes (`/api/schedules`,
  `/api/agents/:id/heartbeat`) are mounted.
- With config (e.g. `extensions.scheduler: {}`): the extension loads and runs.
  `pnpm dev` no longer disables it. Dev mode is purely about port discovery and
  the banner now.

## Tests touched

- `apps/gateway/src/extensions/registry.test.ts` — the "no explicit config"
  case used to assert scheduler+heartbeat in `result`; now asserts they are
  absent and only `multiUser` loads.
- `apps/gateway/src/config/__tests__/validate.test.ts` — same flip: a config
  with no `extensions` block loads nothing.
- `apps/gateway/src/server/capabilities.api.test.ts` — config only enables
  scheduler, so `extensions` in the capabilities response is `{ scheduler: true }`
  (heartbeat is absent rather than `false`).

All `pnpm test:gateway` (201) and `pnpm test:shared` (60) tests pass; gateway
`tsc --noEmit` is clean.

## Follow-ups for someone else

- Users who relied on the silent auto-load of scheduler/heartbeat need to add
  `extensions.scheduler: {}` (and/or `extensions.heartbeat: {}`) to their
  `aihub.json`. Worth calling out in release notes.
- `--dev` flag description still mentions "disable scheduler/heartbeat" — that
  phrase is now misleading; trim it to "auto-find ports" if touched again.
