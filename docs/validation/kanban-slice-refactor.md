# Kanban slice refactor validation

Purpose: exact manual E2E protocol for validating `docs/specs/kanban-slice-refactor.md` after issues `01`–`15` land. Uses CLI for deterministic setup/state assertions and `playwright-cli` for browser validation.

## Preconditions

- Run from repo root.
- All implementation branches merged into this worktree.
- `node_modules` installed. If missing: `pnpm install`.
- Local config exists under this worktree: `.aihub/aihub.json`.
  - If missing, seed from repo template: `pnpm init-dev-config` (runs `scripts/create-local-config.js`, using `scripts/config-template.json`).
- Gateway/web ports come from `.aihub/aihub.json` unless `pnpm dev` chooses next free ports.
- Use a disposable `AIHUB_HOME` only. Never run this smoke against real `~/.aihub` project data.

## Terminal setup

`AIHUB_HOME` must point at this worktree's `.aihub` folder for every command in this protocol, including `pnpm dev`. This keeps the smoke test isolated from real `~/.aihub` data.

```bash
export AIHUB_HOME="$PWD/.aihub"
export AIHUB_API_URL="http://127.0.0.1:4001/aihub"
export UI_URL="http://127.0.0.1:3001"
```

Start app in the same shell where `AIHUB_HOME` is exported:

```bash
pnpm dev
```

Wait until logs show gateway + web ready. If dev auto-selects different ports, update `AIHUB_API_URL` and `UI_URL` from logs before continuing.

In another terminal, confirm capabilities:

```bash
curl -fsS "$AIHUB_API_URL/api/capabilities" | jq .
```

Expected:

- `projects` extension enabled.
- `board` extension enabled when board feature lands.
- HTTP status `200`.

## Playwright session setup

```bash
playwright-cli close-all || true
playwright-cli open "$UI_URL" --browser=chrome
playwright-cli video-start docs/validation/kanban-slice-refactor-e2e.webm
playwright-cli video-chapter "Home loaded" --description="Initial AIHub load" --duration=1000
playwright-cli snapshot --filename=docs/validation/smoke-00-home.yml
```

Keep video recording active through the full browser smoke. Add `playwright-cli video-chapter ...` markers before major phases (board list, project detail, slice drag, agents view, activity feed, final done). If first snapshot shows wrong port or gateway unavailable, stop and fix dev server/config.

## Smoke data setup

Create one project and one slice.

```bash
PROJECT_JSON=$(pnpm aihub:dev projects create \
  --title "Slice refactor E2E smoke" \
  --specs "Validate slice kanban refactor end to end." \
  --status active \
  --json)
PROJECT_ID=$(printf '%s' "$PROJECT_JSON" | jq -r '.id')

SLICE_ID=$(pnpm aihub:dev slices add --project "$PROJECT_ID" "E2E vertical slice")

echo "PROJECT_ID=$PROJECT_ID"
echo "SLICE_ID=$SLICE_ID"
```

Expected filesystem:

```bash
test -f "$AIHUB_HOME/projects/$PROJECT_ID/SCOPE_MAP.md"
test -f "$AIHUB_HOME/projects/$PROJECT_ID/slices/$SLICE_ID/README.md"
test -f "$AIHUB_HOME/projects/$PROJECT_ID/slices/$SLICE_ID/SPECS.md"
test -f "$AIHUB_HOME/projects/$PROJECT_ID/slices/$SLICE_ID/TASKS.md"
test -f "$AIHUB_HOME/projects/$PROJECT_ID/slices/$SLICE_ID/VALIDATION.md"
test -f "$AIHUB_HOME/projects/$PROJECT_ID/slices/$SLICE_ID/THREAD.md"
```

Expected CLI:

```bash
pnpm aihub:dev slices get "$SLICE_ID" | tee /tmp/slice-before.txt
grep -q "id: $SLICE_ID" /tmp/slice-before.txt
grep -q "project_id: $PROJECT_ID" /tmp/slice-before.txt
grep -q "status: todo" /tmp/slice-before.txt
grep -q "$SLICE_ID" "$AIHUB_HOME/projects/$PROJECT_ID/SCOPE_MAP.md"
```

## Feature validation matrix

### 1. Slice storage + CLI add/list/get (#01, #02)

Commands:

```bash
pnpm aihub:dev slices list --project "$PROJECT_ID" --json | jq .
pnpm aihub:dev slices list --status todo --json | jq --arg id "$SLICE_ID" 'map(.id == $id) | any'
pnpm aihub:dev slices get "$SLICE_ID" --json | jq .
```

Pass when:

- Slice ID format is `<PROJECT_ID>-Snn`.
- Slice appears in list filters.
- JSON contains `id`, `projectId`, `title`, `status`, `hillPosition`, `updatedAt`.
- README frontmatter + body render without dropped `null`, `[]`, quoted strings, or escapes.

### 2. Scope map regeneration (#03)

Commands:

```bash
cp "$AIHUB_HOME/projects/$PROJECT_ID/SCOPE_MAP.md" /tmp/scope-before.md
pnpm aihub:dev slices rename "$SLICE_ID" "E2E renamed slice"
cp "$AIHUB_HOME/projects/$PROJECT_ID/SCOPE_MAP.md" /tmp/scope-after-rename.md
pnpm aihub:dev slices move "$SLICE_ID" in_progress
cp "$AIHUB_HOME/projects/$PROJECT_ID/SCOPE_MAP.md" /tmp/scope-after-move.md

grep -q "E2E renamed slice" /tmp/scope-after-rename.md
grep -q "in_progress" /tmp/scope-after-move.md
```

Pass when:

- Header says auto-generated / do not edit.
- Table sorted by slice ID.
- Rename and status move update map deterministically.
- No truncated/partial file.

### 3. Slice mutation CLI (#04)

Commands:

```bash
pnpm aihub:dev slices comment "$SLICE_ID" "E2E comment $(date -u +%FT%TZ)"
pnpm aihub:dev slices move "$SLICE_ID" review
pnpm aihub:dev slices get "$SLICE_ID" | tee /tmp/slice-after-mutations.txt

grep -q "status: review" /tmp/slice-after-mutations.txt
grep -q "E2E comment" "$AIHUB_HOME/projects/$PROJECT_ID/slices/$SLICE_ID/THREAD.md"
```

Invalid input check:

```bash
! pnpm aihub:dev slices move "$SLICE_ID" bogus_status
```

Pass when:

- `updated_at` bumps on each mutation.
- THREAD append preserves prior content.
- Invalid status exits non-zero with clear message.
- SCOPE_MAP changes after each mutation.

### 4. Project lifecycle, cancel cascade, auto-done (#05)

Create extra slice to validate cascade:

```bash
CASCADE_SLICE_ID=$(pnpm aihub:dev slices add --project "$PROJECT_ID" "Cascade slice")
pnpm aihub:dev slices move "$CASCADE_SLICE_ID" in_progress
pnpm aihub:dev projects update "$PROJECT_ID" --status cancelled
pnpm aihub:dev slices get "$CASCADE_SLICE_ID" | grep -q "status: cancelled"
```

Create fresh single-slice project to validate auto-done:

```bash
DONE_PROJECT_JSON=$(pnpm aihub:dev projects create \
  --title "Auto done E2E" \
  --specs "Single slice auto done." \
  --status active \
  --json)
DONE_PROJECT_ID=$(printf '%s' "$DONE_PROJECT_JSON" | jq -r '.id')
DONE_SLICE_ID=$(pnpm aihub:dev slices add --project "$DONE_PROJECT_ID" "Only slice")
pnpm aihub:dev slices move "$DONE_SLICE_ID" done
pnpm aihub:dev projects get "$DONE_PROJECT_ID" --json | jq -e '.status == "done"'
```

Pass when:

- Project `cancelled` moves non-terminal child slices to `cancelled`.
- Done slices stay done.
- Active project with one slice auto-moves to `done` after child slice reaches `done`.
- `ready_to_merge` slice does not auto-mark project done.

### 5. Migration command (#06)

Use separate disposable home:

```bash
MIG_HOME=$(mktemp -d)
AIHUB_HOME="$MIG_HOME" pnpm init-dev-config
# create legacy fixture per status, or use checked-in migration fixture when issue #06 lands
AIHUB_HOME="$MIG_HOME" pnpm aihub:dev projects migrate-to-slices
AIHUB_HOME="$MIG_HOME" pnpm aihub:dev projects migrate-to-slices
```

Pass when:

- Command refuses while gateway for that home is running.
- Second run is no-op.
- Legacy status mapping matches spec §10.1.
- `maybe` / `not_now` become `shaping` with no auto-created slice.
- Existing subagent run state files are unchanged.

### 6. Subagent run attribution + dispatcher/reviewer (#07, #08, #09)

Use active project + todo slice:

```bash
RUN_PROJECT_JSON=$(pnpm aihub:dev projects create \
  --title "Dispatcher E2E" \
  --specs "Dispatcher/reviewer smoke." \
  --status active \
  --json)
RUN_PROJECT_ID=$(printf '%s' "$RUN_PROJECT_JSON" | jq -r '.id')
RUN_SLICE_ID=$(pnpm aihub:dev slices add --project "$RUN_PROJECT_ID" "Worker reviewer slice")
```

Wait for orchestrator Worker dispatch, or trigger manual orchestrator tick if implementation exposes a test hook.

Polling assertions:

```bash
until pnpm aihub:dev slices get "$RUN_SLICE_ID" | grep -Eq "status: (in_progress|review|ready_to_merge)"; do sleep 5; done

pnpm aihub:dev subagents list --json | jq \
  --arg p "$RUN_PROJECT_ID" --arg s "$RUN_SLICE_ID" \
  '.items[] | select(.projectId == $p and .sliceId == $s)'
```

Expected Worker path:

- Slice `todo → in_progress` when Worker claimed.
- Worker run state has `projectId == RUN_PROJECT_ID` and `sliceId == RUN_SLICE_ID`.
- Worker worktree path includes `/<RUN_PROJECT_ID>/<RUN_SLICE_ID>-`.
- Worker prompt references parent README + SCOPE_MAP + current slice docs only.
- Worker completion moves slice to `review`.

Expected Reviewer path:

```bash
until pnpm aihub:dev slices get "$RUN_SLICE_ID" | grep -Eq "status: (ready_to_merge|todo)"; do sleep 5; done
```

Pass path:

- Reviewer run state has same `projectId` + `sliceId`.
- Reviewer uses most recent Worker workspace for same `sliceId`.
- Pass moves `review → ready_to_merge`.
- Parent project remains `active`.

Fail path (if Reviewer fails intentionally):

- Slice moves `review → todo`.
- Slice `THREAD.md` receives structured gap comment.

Sibling isolation check:

```bash
SIBLING_SLICE_ID=$(pnpm aihub:dev slices add --project "$RUN_PROJECT_ID" "Sibling slice")
# Force one slice into cooldown/failure using issue-specific fixture or failing profile.
# Verify sibling still dispatches when capacity exists.
```

Pass when cooldown/active-run dedupe keys by `sliceId`, not `projectId`.

### 7. Browser: project board list (#11)

```bash
playwright-cli goto "$UI_URL/board"
playwright-cli snapshot --filename=docs/validation/smoke-11-board.yml
```

Validate with snapshot refs:

```bash
playwright-cli --raw eval "document.body.innerText"
```

Pass when UI shows:

- Groups: `active`, `shaping`, `done`, `cancelled`.
- `active` + `shaping` expanded by default.
- `done` + `cancelled` collapsed by default with counts.
- Search box filters by `PROJECT_ID` and title.
- Area chips filter; `All` resets.
- Project card includes ID, title, status pill, area chip if set, `n/m slices done`, active run dot when run active, last activity.

Drag/reject validation:

```bash
# Use refs from snapshot.
# Example shape only; replace eCARD/eDONE with actual refs.
playwright-cli drag eCARD eDONE
playwright-cli snapshot --filename=docs/validation/smoke-11-drag-reject.yml
```

Pass when invalid `active → done` before all slices terminal shows toast and reverts.

### 8. Browser: project detail + slice kanban (#10, #12)

```bash
playwright-cli goto "$UI_URL/projects/$RUN_PROJECT_ID"
playwright-cli snapshot --filename=docs/validation/smoke-12-detail.yml
```

Pass when header shows:

- Project ID, title, lifecycle status pill, area, lifecycle action menu.

Tabs:

- Pitch: README renders and saves through WYSIWYG editor.
- Slices: embedded `SliceKanbanWidget(projectId)` shows six columns: `todo`, `in_progress`, `review`, `ready_to_merge`, `done`, `cancelled`.
- Slices: `[+ Add slice]` creates slice under same project.
- Thread: THREAD renders and comment append works.
- Activity: project-scoped feed renders.

Slice kanban drag:

```bash
# Replace refs from snapshot.
playwright-cli drag eSLICE_CARD eREADY_TO_MERGE_COLUMN
playwright-cli snapshot --filename=docs/validation/smoke-12-slice-drag.yml
pnpm aihub:dev slices get "$RUN_SLICE_ID" | grep -q "status: ready_to_merge"
```

Pass when browser drag persists via backend and SCOPE_MAP updates.

Slice detail route:

```bash
playwright-cli goto "$UI_URL/projects/$RUN_PROJECT_ID/slices/$RUN_SLICE_ID"
playwright-cli snapshot --filename=docs/validation/smoke-10-slice-detail.yml
```

Pass when page renders slice frontmatter, Specs, Tasks, Validation, Thread, and recent runs. If flat route exists:

```bash
playwright-cli goto "$UI_URL/slices/$RUN_SLICE_ID"
playwright-cli --raw eval "location.pathname"
```

Expected path: `/projects/$RUN_PROJECT_ID/slices/$RUN_SLICE_ID`.

### 9. Browser: agents view (#13)

```bash
playwright-cli goto "$UI_URL/board/agents"
playwright-cli snapshot --filename=docs/validation/smoke-13-agents.yml
```

Pass when:

- Live runs grouped by project.
- Row shows profile, `sliceId`, started time, `[view]`, `[kill]`.
- Legacy run without `sliceId` still appears with pre-slice/legacy badge.

Kill action:

```bash
# Replace eKILL with actual kill button ref.
playwright-cli click eKILL
playwright-cli snapshot --filename=docs/validation/smoke-13-kill-confirm.yml
# Replace eCONFIRM with actual confirmation ref.
playwright-cli click eCONFIRM
```

Pass when backend sends SIGTERM idempotently and row disappears after exit detection.

### 10. Browser: activity feed (#14)

Project-scoped:

```bash
playwright-cli goto "$UI_URL/projects/$RUN_PROJECT_ID"
# Click Activity tab by visible ref from snapshot.
playwright-cli snapshot --filename=docs/validation/smoke-14-project-activity.yml
```

Cross-project if board home exposes feed:

```bash
playwright-cli goto "$UI_URL/board"
playwright-cli snapshot --filename=docs/validation/smoke-14-board-activity.yml
```

Pass when feed includes newest-first items for:

- Project status transitions.
- Slice status transitions.
- Run start + completion.
- Project/slice thread comments.
- Max 100 entries.

## Final E2E happy path (#15)

Use one fresh project with one slice:

```bash
FINAL_PROJECT_JSON=$(pnpm aihub:dev projects create \
  --title "Final slice smoke" \
  --specs "Worker to reviewer to done." \
  --status active \
  --json)
FINAL_PROJECT_ID=$(printf '%s' "$FINAL_PROJECT_JSON" | jq -r '.id')
FINAL_SLICE_ID=$(pnpm aihub:dev slices add --project "$FINAL_PROJECT_ID" "Final slice")
```

Validate sequence:

1. Browser shows project in `active` group and slice in `todo` column.
2. Orchestrator dispatches Worker.
3. Slice moves `todo → in_progress → review`.
4. Worker run has `projectId` + `sliceId`.
5. Orchestrator dispatches Reviewer.
6. Slice moves `review → ready_to_merge` on pass.
7. Project remains `active` while slice is `ready_to_merge`.
8. Manual merge step: integrate worker branch/worktree per normal project workflow.
9. Move slice to done:

```bash
pnpm aihub:dev slices move "$FINAL_SLICE_ID" done
pnpm aihub:dev slices get "$FINAL_SLICE_ID" | grep -q "status: done"
pnpm aihub:dev projects get "$FINAL_PROJECT_ID" --json | jq -e '.status == "done"'
```

10. Browser updates without full reload: slice appears in `done`; project appears in `done` group after refresh/event.

## Final report

Generate a comprehensive, highly digestible HTML report after the smoke completes. The report should be readable by a human who did not run the test.

Recommended path:

```bash
REPORT_PATH="docs/validation/kanban-slice-refactor-report.html"
```

Minimum report contents:

- Title, date/time, git commit SHA, branch, `AIHUB_HOME`, gateway URL, web URL.
- Environment summary: OS, Node, pnpm, browser, `playwright-cli --version`.
- Test data: project IDs, slice IDs, run IDs, worktree paths.
- Feature checklist grouped by issue `01`–`15`, each marked pass/fail/blocked.
- Timeline table: project status, slice status, Worker run, Reviewer run, manual merge, final done.
- Evidence links/embeds: saved snapshots from `docs/validation/*.yml`, the `playwright-cli` video recording(s), screenshots if captured, relevant command outputs.
- Failure section: exact command, expected result, actual result, logs/snapshot pointer, next action.
- Final verdict: `PASS`, `FAIL`, or `BLOCKED`, with one-paragraph summary.

Stop and save browser video before generating the report:

```bash
playwright-cli video-chapter "Final verdict" --description="Smoke complete; report generation begins" --duration=1000
playwright-cli video-stop
```

Suggested generation flow:

```bash
cat > "$REPORT_PATH" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Kanban Slice Refactor E2E Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 40px; line-height: 1.5; color: #111827; }
    h1, h2 { line-height: 1.2; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    code, pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
    code { padding: 1px 4px; }
    pre { padding: 12px; overflow: auto; }
    .pass { color: #047857; font-weight: 700; }
    .fail { color: #b91c1c; font-weight: 700; }
    .blocked { color: #92400e; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Kanban Slice Refactor E2E Report</h1>
  <p><strong>Verdict:</strong> <span class="blocked">BLOCKED/PASS/FAIL</span></p>
  <h2>Summary</h2>
  <p>Replace with concise result summary.</p>
  <h2>Environment</h2>
  <pre>Paste command output: git rev-parse HEAD; git branch --show-current; node -v; pnpm -v; playwright-cli --version</pre>
  <h2>Test Data</h2>
  <table><tr><th>Name</th><th>Value</th></tr><tr><td>Project</td><td>PRO-XXX</td></tr><tr><td>Slice</td><td>PRO-XXX-S01</td></tr></table>
  <h2>Feature Checklist</h2>
  <table><tr><th>Issue</th><th>Feature</th><th>Status</th><th>Evidence</th></tr><tr><td>01</td><td>Slice storage</td><td class="pass">PASS</td><td>link/output</td></tr></table>
  <h2>Timeline</h2>
  <table><tr><th>Time</th><th>Event</th><th>Evidence</th></tr><tr><td>...</td><td>Slice moved todo → in_progress</td><td>...</td></tr></table>
  <h2>Video Evidence</h2>
  <video controls src="kanban-slice-refactor-e2e.webm" style="max-width: 100%; border: 1px solid #d1d5db; border-radius: 8px;"></video>
  <p>Include chapter notes: home load, board list, project detail, slice drag, agents view, activity feed, final done.</p>
  <h2>Failures / Follow-ups</h2>
  <p>None, or list exact failures with reproduction steps.</p>
</body>
</html>
HTML
```

Open and inspect with Playwright:

```bash
playwright-cli goto "file://$PWD/$REPORT_PATH"
playwright-cli snapshot --filename=docs/validation/report-snapshot.yml
```

Pass when report is self-contained enough for review, embeds or links the Playwright video recording, and clearly communicates verdict, evidence, and next action.

## Regression checks

```bash
pnpm test:web
pnpm test:gateway
pnpm test:shared
pnpm test:cli
```

Legacy project-kanban grep:

```bash
rg -n "project kanban|ProjectsBoard|project status.*kanban|kanban.*project" docs README.md apps packages || true
```

Pass when no stale user-facing project-kanban references remain. Code identifiers may remain only if intentionally renamed by follow-up; document exceptions in handoff.

## Cleanup

```bash
playwright-cli close-all
# Optional: remove disposable smoke projects from .aihub/projects if desired.
```
