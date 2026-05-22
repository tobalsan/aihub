# Update Models Fallback Sources

- Updated `pnpm update-models` to include model IDs from `$AIHUB_HOME/models.json` provider `models[]` and `modelOverrides`.
- Added `models.json` `contextWindow` support so local custom model window sizes are written directly.
- Added `https://models.dev/api.json` as fallback for configured models missing from OpenRouter.
- Added focused tests for model collection, local context windows, and fallback merging.

Verification:
- `pnpm exec vitest run scripts/update-models.test.ts`
- `pnpm exec tsc -b`
