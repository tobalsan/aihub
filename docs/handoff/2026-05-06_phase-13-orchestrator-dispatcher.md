# Phase 13: Projects Orchestrator Dispatcher

Refactored `packages/extensions/projects/src/orchestrator/dispatcher.ts` from a broad 1.9k-line owner into a tick coordinator backed by focused modules:

- `dispatch-policy.ts`: `SliceDispatchPolicy` plus status/profile/run matching, blocker, cooldown, and concurrency helpers.
- `prompt-factory.ts`: `OrchestratorPromptFactory` plus `resolveAihubCli()` and Worker/Reviewer/Merger prompt templates.
- `run-planner.ts`: `OrchestratorRunPlanner` plus slug generation, worker workspace/branch lookup, fallback cwd calculation, and spawn input construction.

Added focused module tests:

- `dispatch-policy.test.ts`
- `prompt-factory.test.ts`
- `run-planner.test.ts`

Dispatcher behavior remains covered by `orchestrator/index.test.ts`; focused orchestrator tests passed after extraction.
