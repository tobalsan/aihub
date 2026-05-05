# Done Slice Ping

- Added orchestrator `notify_channel` support for one daily done-slice ping per project when `<projectId>/integration` is ahead of `main`.
- The ping uses `aihub notify --channel <channel> --message <digest>` in prod, and `pnpm --dir <root> aihub:dev notify ...` in dev.
- Exported a small notifier seam and covered the actual default prod/dev exec args, not only injected notifier calls.
- The in-memory daily gate clears when integration is no longer ahead, so a later new ahead state can notify again.
- Focused validation: `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`, `pnpm exec vitest run apps/gateway/src/cli/notify.test.ts`, `pnpm exec vitest run packages/shared/src/__tests__/notify.test.ts packages/shared/src/types.test.ts`, `pnpm build`, `pnpm --silent aihub:dev notify --help`, `pnpm --silent aihub notify --help`.
