# Shaping Pipeline

Implemented v1 shaping pipeline support:

- Project statuses now accept `shaping:<stage>` alongside lifecycle statuses.
- Project updates stamp `last_status_change_at` when status changes.
- Orchestrator config accepts `orchestrator.shaping_statuses` as a project-level phase manifest.
- Orchestrator dispatches `type: "shaper"` profiles for projects whose status matches a shaping manifest key, with one running shaper per project and per-status concurrency.
- Stale shaping stages move to `shaping:blocked` and get an Orchestrator THREAD comment.
- Shaper prompts load `.aihub/prompts/<ProfileName>.md` when present, using `${variable}` substitution with unresolved-variable errors; otherwise a default prompt is used.
- Board lifecycle mapping groups any `shaping:*` status under Shaping.
- Shaping cards show a stage badge and sort by the default stage order.

Validation run:

- `pnpm --filter @aihub/shared build && pnpm exec tsc -p packages/extensions/projects/tsconfig.json --noEmit`
- `pnpm test:shared`
- `pnpm test:gateway -- --runInBand`
- `pnpm exec vitest run packages/extensions/projects/src/orchestrator packages/extensions/projects/src/projects/document-store.test.ts apps/web/src/components/board/ProjectListGrouped.test.tsx`
- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts`

Note: running board tests in the same Vitest command as the heavier orchestrator/web set intermittently timed out; rerunning the board test file alone passed.
