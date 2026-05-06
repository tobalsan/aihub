# Extension Runtime Module

Phase 5 extracted extension read/lookup state into `apps/gateway/src/extensions/runtime.ts`.

- `ExtensionRuntime` now owns loaded extensions, route matchers, enabled checks, prompt contributions, tool lookup/dispatch, capabilities, and load/unload/reload lifecycle.
- `registry.ts` remains startup/factory glue for built-in/external discovery, validation, dependency ordering, and home-route resolution, then populates the runtime.
- HTTP, WebSocket, CLI send, eval, SDK adapter, container input, and `/internal/tools` paths now thread or resolve the active runtime for extension prompt/tool behavior.
- Added `apps/gateway/src/extensions/runtime.test.ts`.

Verification:

- `pnpm exec vitest run apps/gateway/src/extensions/runtime.test.ts apps/gateway/src/extensions/registry.test.ts apps/gateway/src/server/capabilities.api.test.ts apps/gateway/src/server/extension-routing.api.test.ts apps/gateway/src/cli/gateway.test.ts`
- `pnpm exec vitest run apps/gateway/src/sdk/pi/__tests__/adapter-onecli.test.ts apps/gateway/src/server/internal-tools.test.ts apps/gateway/src/server/api.core.test.ts apps/gateway/src/sdk/container/adapter.test.ts`
- `pnpm --filter @aihub/gateway build`

`pnpm test:gateway` was also run, but this sandbox denied local socket listening (`listen EPERM` on `127.0.0.1`/`0.0.0.0`) for WebSocket/OpenClaw tests. Runtime-related assertion failures from that run were fixed and rechecked with focused suites.
