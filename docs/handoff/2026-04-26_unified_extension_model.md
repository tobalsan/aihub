# 2026-04-26 Unified Extension Model

- Rebased the worktree onto `main` and created branch `codex/unified-extension-model`.
- Removed the separate connector runtime/config surface. Root `extensions.<id>` now stores shared defaults, and `agents[].extensions.<id>` opts agents into tool-style extensions unless `enabled: false`.
- Added `packages/shared/src/tool-extension.ts` for migrated stateless tool bundles, including root/agent config merge, `$env:` resolution, required secret validation, tool name prefixing, and JSON Schema conversion.
- Gateway startup, `aihub send`, eval runtime, Pi runtime, and container runtime now load/use unified extensions. Container tool calls use `ContainerInput.extensionTools` and `/internal/tools`; connector config serialization and `/connectors/tools` are gone.
- External extension discovery now loads from `extensionsPath` or `$AIHUB_HOME/extensions`, follows symlinked directories, and skips directories without `index.js` so stale Board user-content folders do not emit broken-extension warnings.
- Board user content now defaults to `$AIHUB_HOME`; `extensions.board.contentRoot` overrides it. Tests cover default and custom content paths.
- Migrated `/Users/thinh/code/algodyn/cloudi-fi/aihub-connectors` to export tool extensions for `cloudifi_admin`, `gsheets`, `hiveage`, and `notion`; package docs/tests use extension terminology.

Validation run:

- `pnpm exec tsc -b --pretty false`
- `pnpm test:shared`
- `pnpm test:gateway`
- `pnpm test:cli`
- `pnpm --filter @aihub/agent-runner test`
- Focused Vitest runs for tool extensions, extension registry/config validation, container adapter/runner, Pi adapter, CLI gateway, and Board.
- External package: `pnpm build`, `pnpm test` in `/Users/thinh/code/algodyn/cloudi-fi/aihub-connectors`.
