# Update Models Additive Merge

## Summary

- `pnpm update-models` now reads existing `packages/shared/src/model-context-data.json` and merges newly discovered context data over it.
- Existing model entries are preserved unless the current discovery returns the same model id.

## Verification

- `pnpm exec vitest run scripts/update-models.test.ts`
- `AIHUB_HOME=$PWD/.aihub pnpm update-models`
- `pnpm exec tsc -b`
