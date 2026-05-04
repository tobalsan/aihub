# 2026-05-04 — Gateway-created project + slices CLI filesystem mismatch

## Summary
Fixed slices CLI root-resolution mismatch that caused `slices add/list/get` to read wrong projects root when config only set `extensions.projects.root` (common gateway config shape). This made gateway-created slugged project dirs effectively invisible/misaligned for filesystem assertions.

## Changes

### 1) Root resolution compatibility
- File: `packages/extensions/projects/src/util/paths.ts`
- `getProjectsRoot(config)` now resolves in order:
  1. `config.projects?.root`
  2. `config.extensions?.projects?.root`
  3. `~/projects`

Effect: slices CLI and other filesystem consumers use same root as gateway project creation, including slugged project directories like `PRO-2_some-title`.

### 2) Regression test
- File: `packages/extensions/projects/src/cli/slices.test.ts`
- Added test: `works for slugged project dir when config uses extensions.projects.root`
  - Seeds `aihub.json` with only `extensions.projects.root`
  - Creates slugged project dir `PRO-222_gateway-created-project`
  - Runs `slices add --project PRO-222 "Gateway slice"`
  - Asserts slice docs created under slugged dir and `SCOPE_MAP.md` regenerated.

### 3) Docs update
- File: `docs/llms.md`
- Added fact that slices CLI supports both `projects.root` and `extensions.projects.root`.

## Validation
- Ran: `pnpm test:cli`
- Result: pass (`8` files, `49` tests).

## Notes
- `plan.md` at requested root path missing (`ENOENT`). Implemented from spec + validation report context.
