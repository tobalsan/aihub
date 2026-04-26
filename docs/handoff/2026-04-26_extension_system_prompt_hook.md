# 2026-04-26 Extension System Prompt Hook

## Summary

- Added optional `Extension.getSystemPromptContributions(agent)` to the shared extension contract.
- Added gateway collector `apps/gateway/src/extensions/prompts.ts`.
- Added optional `Extension.getAgentTools(agent)` plus gateway collector/dispatch in `apps/gateway/src/extensions/tools.ts`.
- Removed board-specific scratchpad prompt special casing from the Pi adapter.
- Board now contributes its scratchpad prompt and callable scratchpad tools through extension hooks.
- Subagents now contributes CLI use, monitoring, and lifecycle command guidance through the extension hook.
- In-process Pi runs append extension prompts and mount extension tools directly.
- Container runs now carry extension prompt text in `ContainerInput.extensionSystemPrompts`, extension tool definitions in `ContainerInput.extensionTools`, and execute those tools through `/internal/tools`.

## Verification

- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/gateway build`
- `pnpm --filter @aihub/agent-runner build`
- `pnpm --filter @aihub/extension-board build`
- `pnpm --filter @aihub/extension-subagents build`
- `pnpm exec vitest run packages/shared/src/__tests__/extension-types.test.ts`
- `pnpm exec vitest run packages/shared/src/types.test.ts`
- `pnpm exec vitest run packages/extensions/board/src/index.test.ts`
- `pnpm exec vitest run apps/gateway/src/server/internal-tools.test.ts`
- `pnpm exec vitest run apps/gateway/src/sdk/pi/__tests__/adapter-onecli.test.ts`
- `pnpm exec vitest run apps/gateway/src/sdk/container/adapter.test.ts`
- `pnpm exec vitest run container/agent-runner/src/__tests__/runner.test.ts`
- `pnpm exec vitest run packages/extensions/subagents/src/index.test.ts`
