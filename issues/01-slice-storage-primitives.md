---
title: Slice storage primitives
type: AFK
labels: [needs-triage]
spec: docs/specs/kanban-slice-refactor.md
---

## What to build

Foundation for slices on disk. Implements filesystem layout, per-project ID counter, slice frontmatter schema, and read/write helpers in `shared`/`gateway` (wherever existing project store lives).

End-to-end behavior: programmatic API can create a slice under a project, allocate the next `PRO-XXX-Snn` ID, write the slice directory tree, read it back, and update frontmatter atomically.

Touches:
- `<projectDir>/.meta/counters.json` (new) — `{ lastSliceId }`
- `<projectDir>/slices/<PRO-XXX-Snn>/` — `README.md` (frontmatter), `SPECS.md`, `TASKS.md`, `VALIDATION.md`, `THREAD.md`
- Slice frontmatter: `id`, `project_id`, `title`, `status`, `hill_position`, `created_at`, `updated_at`
- Atomic write helper (temp file + rename) reused for all slice mutations.

## Acceptance criteria

- [ ] `slices/` and `.meta/counters.json` created on first slice add for a project
- [ ] Slice ID format `PRO-XXX-Snn`; counter persists per project
- [ ] Slice frontmatter parsed/serialized round-trip without loss
- [ ] Atomic write: partial write cannot leave half-written README on disk
- [ ] Concurrent slice creates on the same project don't collide on ID (counter increment guarded)
- [ ] Unit tests cover create, read, update, ID allocation, concurrent allocation
- [ ] No CLI surface yet; pure module API
- [ ] `pnpm test:shared` (or relevant scope) passes

## Blocked by

None - can start immediately
