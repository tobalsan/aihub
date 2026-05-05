# Project Create Pitch

## Summary

`aihub projects create` now treats project prose as a pitch. The CLI accepts a positional pitch or `--pitch <text|@file|->`, sends `pitch` to the projects API, and rejects hidden project-level `--specs` with a migration hint.

New projects write frontmatter-only `README.md`, always create `PITCH.md`, and expose the created pitch through `docs.PITCH`. `THREAD.md` creation is unchanged.

## Validation

- `pnpm test:cli`
- `pnpm test:shared`
- `pnpm typecheck`
