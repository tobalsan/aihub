# Remove `tickSeconds` from scheduler extension

`extensions.scheduler.tickSeconds` was dead config. The constructor in
`packages/extensions/scheduler/src/service.ts` read it into `this.tickMs`, but
nothing else referenced that field — the runner arms its timer with
`setTimeout(..., nextAt - Date.now())` in `armTimer()`, where `nextAt` is the
minimum `nextRunAtMs` across enabled jobs. The field was a leftover from an
earlier fixed-interval polling implementation.

## What changed

Schema (`packages/shared/src/types.ts`):

- `SchedulerExtensionConfigSchema` is now `z.object({ enabled?: boolean })`.
- The duplicate inline scheduler shape inside `ExtensionsConfigSchema` matches.

Code (`packages/extensions/scheduler/src/service.ts`):

- Dropped the unused `tickMs` field and its assignment from the constructor.

Migration (`packages/shared/src/config-migrate.ts`):

- `LegacyGatewayConfig.scheduler` no longer types `tickSeconds`.
- The heartbeat-implies-scheduler branch and the explicit-scheduler branch no
  longer copy `tickSeconds` into `extensions.scheduler`.

Tests updated to drop `tickSeconds: 60` filler and replace
`tickSeconds`-specific assertions with `enabled` checks:

- `packages/shared/src/__tests__/extension-types.test.ts`
- `packages/shared/src/__tests__/config-v2.test.ts`
- `packages/extensions/projects/src/cli/config.commands.test.ts`
- `apps/gateway/src/config/config.test.ts`
- `apps/gateway/src/config/__tests__/migrate.test.ts`
- `apps/gateway/src/config/__tests__/validate.test.ts`
- `apps/gateway/src/server/capabilities.api.test.ts`
- `apps/gateway/src/extensions/registry.test.ts` — the "fails on invalid
  extension config" case used `tickSeconds: "bad"`; switched to
  `enabled: "bad"` so the schema still rejects it.

Docs:

- `README.md`: removed `tickSeconds` from both scheduler example blocks.
- `docs/llms.md`: removed `tickSeconds?` from both config-shape sketches and
  from the scheduler services section.
- `packages/extensions/scheduler/README.md`: dropped the `tickSeconds` config
  bullet, the example value, and the misleading "upper bound for empty-queue
  checks" line; now just documents `enabled` and the dynamic-wake timer.

## Compatibility

`SchedulerExtensionConfigSchema` and the inline shape are both `z.object`
without `.strict()`, so existing `aihub.json` files that still carry
`tickSeconds: 60` will continue to parse — the field is silently stripped.
No migration step needed beyond the optional cleanup of the field from local
configs.

## Out of scope

`docs/specs/extension-refactor.md`, `docs/specs/extension-dependency-audit.md`,
and `docs/prp/aihub-v1-prp.md` still mention `tickSeconds` as part of their
historical narratives. Left as-is — they document past state of the project.
