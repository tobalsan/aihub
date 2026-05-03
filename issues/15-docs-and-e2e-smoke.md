---
title: Docs update + E2E smoke test
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md (§12)
---

## What to build

Final landing slice. Documentation + verifiable end-to-end run.

Docs:
- Update `docs/llms.md` to reflect the new model (slices as kanban unit, project lifecycle vs slice kanban, orchestrator keyed by sliceId, config-key historical artifact note re `extensions.projects.orchestrator`).
- Write handoff under `docs/handoff/<YYYY-mm-dd>_kanban-slice-refactor.md` summarizing the refactor, slice-by-slice, with pointers to each issue.

E2E smoke test:
- Spawn one project, slice it, dispatch Worker → Reviewer → `ready_to_merge` → `done` on the new model.
- Verify: slice progresses through every status; Worker + Reviewer runs both attribute correctly to `sliceId` + `projectId`; SCOPE_MAP regenerates at each step; project remains `active` throughout; manual move to `done` flips slice; auto active→done fires when only-slice is `done`.
- Codified as a script + doc in `docs/handoff/` for repeatability.

## Acceptance criteria

- [ ] `docs/llms.md` reflects post-refactor model (no stale references to project kanban)
- [ ] Handoff doc written under `docs/handoff/<YYYY-mm-dd>_kanban-slice-refactor.md`
- [ ] E2E smoke completes without manual intervention beyond the documented "user merges branch" step
- [ ] Smoke test runnable from CLI; documented in handoff
- [ ] All scoped test commands pass: `pnpm test:web`, `pnpm test:gateway`, `pnpm test:shared`, `pnpm test:cli`
- [ ] No legacy project-kanban references remain in code or docs (grep-clean)

## Blocked by

- All prior issues (#1–#14)
