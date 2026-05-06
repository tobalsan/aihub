# Scratchpad tool exposure fix

## Context

After refactor commit `59a79350d4aa`, lead agents could see Board scratchpad prompt guidance but the scratchpad tools were not exposed as callable tools.

## Root cause

AIHub passed `tools: ["read", "bash", "edit", "write"]` to Pi `createAgentSession()`. In the current Pi SDK, `tools` is an allowlist, so registered `customTools` were filtered out unless their provider-safe aliases were also included.

## Changes

- `apps/gateway/src/sdk/pi/adapter.ts`
  - Build the Pi `tools` allowlist from built-in tools plus extension custom tool aliases.
- `container/agent-runner/src/runner.ts`
  - Do the same for sandbox/container Pi runs, including `send_file`.
- Tests updated to assert custom tool aliases are present in the allowlist.
- `docs/llms.md` updated with the Pi allowlist gotcha.

## Validation

Run:

```bash
pnpm exec vitest run apps/gateway/src/sdk/pi/__tests__/adapter-onecli.test.ts
pnpm exec vitest run container/agent-runner/src/__tests__/runner.test.ts
```
