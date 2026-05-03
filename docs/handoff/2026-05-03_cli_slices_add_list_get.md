# Handoff — CLI slices add/list/get

## Summary
Implemented top-level `aihub slices` command group with:
- `add --project <PRO-XXX> "<title>"`
- `list [--project <id>] [--status <s>]`
- `get <sliceId>`

Implementation uses existing slice storage primitives (`createSlice`, `getSlice`) and filesystem project discovery.

## Files
- `packages/extensions/projects/src/cli/slices.ts`
- `packages/extensions/projects/src/cli/slices.test.ts`
- `packages/extensions/projects/src/cli/index.ts`
- `packages/extensions/projects/src/index.ts`
- `apps/gateway/src/cli/index.ts`

## Behavior
- `aihub slices add --project <PRO-XXX> "<title>"` creates slice on disk, prints new slice ID.
- `aihub slices list` works no flags, supports `--project` and `--status` filters.
- `aihub slices get <sliceId>` resolves slice across all discovered projects.
- Clear errors:
  - missing project: `Project not found: <id>`
  - missing slice: `Slice not found: <sliceId>`

## Scope notes
- No SCOPE_MAP generation/mutation hooks added. Deferred to issue 03.
- No mutation commands beyond add/list/get.

## Checks
- `pnpm test:cli` ✅
