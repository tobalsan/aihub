# Scheduler CLI (PRO-254)

Added `aihub scheduler` as a thin wrapper over `/api/schedules`. No new
server-side endpoints. CLI lives in
`packages/extensions/scheduler/src/cli/` and is registered onto the gateway
program in `apps/gateway/src/cli/index.ts`.

## Commands

`list / get / create / update / enable / disable / delete`. All accept `-j`.

- `create` derives `--name` as `<agent>-every-<dur>` or `<agent>-daily-HH:MM`
  when omitted.
- `update` requires `--every` or `--daily` for any schedule change because the
  server PATCH replaces the whole schedule; `--tz` / `--start-at` alone are
  rejected.
- `--session` requires `-m <message>` for the same reason (server replaces
  the payload).
- `delete` prompts unless `-y` is passed; non-TTY without `-y` aborts.

## Auth & config

`SchedulerApiClient` (in `cli/client.ts`) follows the same precedence the
projects CLI uses:

1. `AIHUB_API_URL` / `AIHUB_URL`
2. `$AIHUB_HOME/aihub.json` `apiUrl`

Token from `AIHUB_TOKEN` env or `aihub.json` `token`, sent as
`Authorization: Bearer ...`.

## Known limitation (carried from server)

`GET /api/schedules` returns only enabled jobs. So `aihub scheduler get/list`
cannot see a disabled job. `disable` echoes the full job back so callers can
keep the id; otherwise re-enabling requires direct file edits or the HTTP
PATCH route. We documented this explicitly in
`packages/extensions/scheduler/README.md`.

## Tests

`packages/extensions/scheduler/src/cli/schedule-input.test.ts` (20 tests) and
`packages/extensions/scheduler/src/cli/index.test.ts` (11 tests) cover the
pure functions:

- duration / daily parsing
- schedule input rejection cases (`--every + --daily`, `--tz` without
  `--daily`, `--start-at` without `--every`, bad ISO)
- default name derivation
- table rendering
- `buildCreateBody` / `buildUpdateBody` request shapes (`enable`/`disable`
  conflict, schedule rebuild, payload replacement rules, empty patch
  rejection)

Run with:
`pnpm exec vitest run packages/extensions/scheduler/src/cli/`.

## Pre-existing issues out of scope

`pnpm lint` reports one pre-existing error in `apps/web/src/App.tsx:555`
(unused `SliceDetailRouteShell`). Confirmed present before this change; left
untouched.
