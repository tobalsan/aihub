# 2026-04-26 Extension System Prompt Hook

## Summary

- Added optional `Extension.getSystemPromptContributions(agent)` to the shared extension contract.
- Added gateway collector `apps/gateway/src/extensions/prompts.ts`.
- Removed board-specific scratchpad prompt special casing from the Pi adapter.
- Board now contributes its scratchpad prompt through the extension hook.
- Subagents now contributes CLI use, monitoring, and lifecycle command guidance through the extension hook.
- Container runs now carry extension prompt text in `ContainerInput.extensionSystemPrompts` and append it in the runner.

## Verification

- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/gateway build`
- `pnpm --filter @aihub/agent-runner build`
- `pnpm --filter @aihub/extension-board build`
- `pnpm --filter @aihub/extension-subagents build`
- `pnpm exec vitest run packages/shared/src/__tests__/extension-types.test.ts`
- `pnpm exec vitest run packages/shared/src/types.test.ts`
- `pnpm exec vitest run packages/extensions/board/src/index.test.ts`
- `pnpm exec vitest run apps/gateway/src/sdk/container/adapter.test.ts`
- `pnpm exec vitest run container/agent-runner/src/__tests__/runner.test.ts`
- `pnpm exec vitest run packages/extensions/subagents/src/index.test.ts`
