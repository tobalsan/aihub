# Projects Help Cleanup

Date: 2026-04-27

## Context

`aihub projects --help` still advertised the deprecated `agent` helper, and `aihub projects create --help` advertised legacy create metadata flags.

## Changes

- Hid `aihub projects agent` from top-level help while preserving the command for compatibility.
- Hid legacy `projects create` flags from help: `--domain`, `--owner`, `--execution-mode`, `--appetite`.
- Added help-output tests for the project CLI.
- Updated README/LLM docs so create examples no longer advertise deprecated flags.

## Verification

- `pnpm exec vitest run packages/extensions/projects/src/cli/help.test.ts`
- `pnpm test:cli`
- `pnpm --filter @aihub/extension-projects exec tsc --noEmit`
