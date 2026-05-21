# Clarify migrate CLI docs

## Summary
- Verified migration command is `pnpm aihub agents migrate`.
- `pnpm aihub --help` lists parent command `agents`; nested help via `pnpm aihub agents --help` lists `migrate`.
- `pnpm aihub projects config migrate` remains separate v1 -> v2 projects-extension config migration.

## Updates
- `README.md`: clarified v2 -> v3 agent-folder migration command and added `--help` references.
- `docs/llms.md`: recorded distinction between `agents migrate` and `projects config migrate`.

## Verification
- Ran:
  - `pnpm aihub --help`
  - `pnpm aihub agents --help`
  - `pnpm aihub agents migrate --help`
