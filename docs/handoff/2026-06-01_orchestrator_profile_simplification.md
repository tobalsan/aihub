# Orchestrator profile simplification

- Removed workflow `agent.default_profile` and `agent.label_profiles` support from orchestrator.
- Orchestrator now uses only `agent.profile` from `WORKFLOW.md` to select the subagent runtime profile.
- Default generated `WORKFLOW.md` now uses `agent.profile: worker` and active states `[Todo, In Progress]`.
- Workspace root override remains relative to `$AIHUB_HOME` when non-absolute.

Validation:

- `pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts`
- `pnpm --filter @aihub/extension-orchestrator build`

Operator note:

- Existing local `$AIHUB_HOME/WORKFLOW.md` files using `agent.default_profile` must be edited to `agent.profile`.
