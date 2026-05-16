# pnpm v11 build approvals

## Summary

`pnpm init-dev-config` failed after pnpm v11 because pnpm ran dependency status checks and rejected ignored lifecycle builds before invoking the package script.

## Change

- Updated `pnpm-workspace.yaml` `allowBuilds` placeholders to explicit booleans:
  - `better-sqlite3: true`
  - `esbuild: true`
  - `koffi: true`
  - `protobufjs: true`
- Updated `docs/llms.md` with pnpm v11 approval note.

## Verification

- `pnpm install` succeeds and runs approved build scripts.
- `pnpm init-dev-config` succeeds and writes `.aihub/aihub.json`, copies agents, seeds demo projects.
