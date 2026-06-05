# Pi provider workflow agent config

## Change

Added `agent.provider` support for orchestrator `WORKFLOW.md` Pi RPC workers.

## Context

Pi is multi-provider. If `agent.model` is set without a provider, Pi may default to an unconfigured provider and fail before dispatch starts.

## Implementation

- `WorkflowFrontmatter.agent.provider` accepts a string.
- Runtime profiles can carry optional `provider`.
- Synthetic orchestrator profiles preserve workflow `provider`.
- Pi RPC default command now passes `--provider <provider>` before `--model <model>`.
- Workflow `agent.provider` overrides profile `provider` for Pi command assembly.
- Pi RPC log events now suppress `message_update` text/thinking deltas and only emit `worker.pi.message` for final assistant message events, avoiding duplicate initial prompts and partial spam in orchestrator logs.

## Validation

Run:

```bash
pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts
pnpm --filter @aihub/extension-orchestrator build
```
