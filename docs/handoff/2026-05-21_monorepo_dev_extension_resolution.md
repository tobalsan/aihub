# Monorepo dev extension resolution

## Summary

- Fixed `pnpm dev:gateway` failing to load configured first-party optional extensions (`projects`, `board`) when gateway does not declare them as direct package dependencies.
- Gateway extension registry now falls back to monorepo source imports for `@aihub/extension-projects` and `@aihub/extension-board` when running in dev (`AIHUB_WEB_DEV=1` or `NODE_OPTIONS=--conditions=development`) and package-name import is not linked.
- Project CLI registration uses the same dev fallback for `@aihub/extension-projects`.

## Verification

- `pnpm --filter @aihub/gateway exec tsc --noEmit`
- `pnpm dev:gateway` started and loaded `subagents, projects, board, discord` without the previous `ERR_MODULE_NOT_FOUND` failure; command was manually timed out after startup.
