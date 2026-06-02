# Orchestrator Symphony alignment implementation

Implemented the Symphony-alignment PRD direction for the orchestrator extension.

Key changes:

- `extensions.orchestrator` now uses `projects[]`, supervisor concurrency, and validation settings instead of dispatch scope in gateway config.
- Each configured project must contain uppercase `WORKFLOW.md`.
- Workflow config owns Linear `tracker.project_slug`, endpoint/auth, states, workspace root, hooks, agent adapter config, and prompt.
- Linear polling now filters by Linear project `slugId`.
- Core workspace layout is directory-only per issue; no repo label routing or git/worktree behavior remains in orchestrator runtime.
- Daemon now acts as a multi-project supervisor, with global plus per-project concurrency.
- Gateway-owned worker lifetime semantics: shutdown stops active workers; startup marks open runs `interrupted_gateway_restart` instead of reattaching live sessions as authority.
- SQLite state is project-aware for runs/events/claims and remains observability/history.
- CLI/API/web dashboard clients now use project-aware routes.

Validation:

- `pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts packages/extensions/orchestrator/src/cli/cli.test.ts`
- `pnpm --filter @aihub/extension-orchestrator build`
- `pnpm build:web`

Notes:

- Existing live `.aihub/aihub.json` must migrate to `extensions.orchestrator.projects[]`.
- Each project `WORKFLOW.md` must include at least tracker auth and `tracker.project_slug`.
- Old projects/board cleanup remains blocked on explicit HITL approval.
