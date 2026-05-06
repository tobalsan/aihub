# Subagent Profile Resolver

- Added `packages/extensions/projects/src/profiles/resolver.ts` to centralize runtime profile merging, legacy template mapping, runMode normalization, and CLI option defaults/validation.
- Rewired projects orchestrator, project start validation, runtime subagents API, and gateway `aihub subagents profiles` listing to use the resolver.
- Added resolver coverage plus a sandbox-safe home-expansion fix for `packages/extensions/subagents/src/index.test.ts`.
- Verification: resolver/orchestrator/subagents focused tests, gateway CLI subagent test, `pnpm test:shared`, and `pnpm exec tsc -b packages/extensions/projects packages/extensions/subagents apps/gateway` pass. Full `pnpm test:gateway` still cannot complete in this sandbox because listening sockets fail with `EPERM`.
