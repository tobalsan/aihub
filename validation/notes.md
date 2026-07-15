# YOP-15 validation

- Branch: `main`
- Scoped Discord tests: PASS (95 tests)
- `pnpm lint`: PASS (warnings only)
- `pnpm typecheck`: PASS
- Real Discord E2E: not run. The isolated-home gateway can be launched locally, but this workspace has no Discord bot token or dedicated Discord guild/channel; those are required to connect the actual extension and prove reactions, CDN downloads, and message edits.
