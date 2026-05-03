# Handoff — kanban slice validation doc

Date: 2026-05-03

## Scope

Created `docs/validation/kanban-slice-refactor.md`: manual E2E validation procedure for `docs/specs/kanban-slice-refactor.md`, using CLI for deterministic setup/assertions and `playwright-cli` for browser validation.

## Notes

- Checked `.aihub/aihub.json`; it already exists in this worktree, so local config seed was not run.
- Validation doc explicitly requires `AIHUB_HOME=$PWD/.aihub` for `pnpm dev` and all smoke commands.
- Document records current seed command as `pnpm init-dev-config` / `scripts/create-local-config.js` using `scripts/config-template.json`.
- Validation doc covers issues `01`–`15`: storage, CLI, scope map, mutations, project lifecycle, migration, subagent attribution, dispatcher/reviewer, slice kanban, board list/detail/agents/activity, final E2E smoke, final HTML report generation, and embedded `playwright-cli` video evidence.
- Some route/CLI names may need final adjustment after all busy agents land their implementations, especially new board/slice detail routes.

## Files changed

- `docs/validation/kanban-slice-refactor.md`
- `docs/handoff/2026-05-03_kanban-slice-validation-doc.md`
