# Handoff — 2026-05-04 — Kanban endpoint follow-up

## Scope

Fix report follow-up #1 from `docs/validation/kanban-slice-refactor-report.html`:

- Doc endpoint mismatch (`AIHUB_API_URL=http://127.0.0.1:4001/aihub` caused `/aihub/api/capabilities` 404).

## Findings

- Validation protocol hardcoded base URL with `/aihub` suffix in:
  - `docs/validation/kanban-slice-refactor.md`
- Same protocol then called `"$AIHUB_API_URL/api/capabilities"`.
- Gateway expected root base URL (`http://127.0.0.1:4001`), not `/aihub` prefixed path in this setup.
- No evidence of configurable gateway base-path support in current validation flow/docs needing code change.

## Change made

- Updated validation doc env example:
  - `AIHUB_API_URL="http://127.0.0.1:4001/aihub"`
  - → `AIHUB_API_URL="http://127.0.0.1:4001"`

File changed:

- `docs/validation/kanban-slice-refactor.md`

## Why this fix

- Smallest behavior-preserving fix.
- Aligns validation instructions with observed gateway behavior in report.
- Avoids runtime/API behavior changes.

## Tests

- Scoped check run (docs-only change):
  - `pnpm -s prettier --check docs/validation/kanban-slice-refactor.md docs/handoff/2026-05-04_kanban_endpoint_followup.md`
