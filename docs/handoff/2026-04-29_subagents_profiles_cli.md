# Subagents Profiles CLI

Added `aihub subagents profiles` as a local config-backed command.

- Reads `loadConfig().extensions?.subagents?.profiles`.
- Prints configured profiles as `name cli model type runMode`.
- Prints raw profile array with `--json`.
- Prints `No profiles configured` when missing or empty.
- Updated runtime profile schema to preserve `description`, `reasoning`, `type`, and `runMode` from config.

Verification:

- `pnpm exec vitest run apps/gateway/src/cli/subagent.test.ts`
- `pnpm exec tsc -b`
