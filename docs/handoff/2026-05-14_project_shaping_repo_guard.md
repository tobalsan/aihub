# Project Shaping Repo Guard

## Summary

- Added `docs/specs/project-shaping-repo-prd.md`.
- Project moves into `shaping` or any `shaping:*` now require strict project-level `repo`.
- Missing repo move failures return `Cannot move project to Shaping: project repo is not set.`
- Added `POST /api/projects/validate-repo` using the existing `.git` path check.
- `aihub projects create --area <area>` copies the area repo into project `repo`; explicit `--repo` wins.
- Kanban project create now shows an editable repo input, prefills it from selected area repo, preserves user edits across area changes, and validates non-empty repo paths on blur without blocking creation.
- Follow-up fix: `/projects` drag/drop now shows a fixed error toast when status update fails instead of only refetching and rethrowing.

## Verification

- `pnpm exec vitest run packages/extensions/projects/src/projects/store.test.ts packages/extensions/projects/src/projects/projects.api.test.ts packages/extensions/projects/src/cli/index.create.test.ts apps/web/src/components/ProjectsBoard.trueModal.test.tsx`
- `pnpm test:cli`
- `pnpm test:web`
- `pnpm test:shared`
- `pnpm exec vitest run --dir packages/extensions/board/src`
- `pnpm exec vitest run --dir packages/extensions/projects/src --pool forks --maxWorkers=1 --minWorkers=1`
- `pnpm typecheck`
