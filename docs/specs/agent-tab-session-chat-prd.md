# Agent Tab Session Chat PRD

## Goal

Replace the project and slice `Agent` tabs with a full-width session sidebar plus interactive chat UI for agent runs.

## Scope

In scope:
- Project detail `Agent` tab.
- Slice detail `Agent` tab.
- Runtime subagent runs shown as individual sessions/attempts.
- Interactive resume for selected runs.

Out of scope:
- Worktree run inspectors in project overview surfaces.
- Unassigned runtime run inspectors.
- Raw log viewer links.
- New backend storage model.

## User Experience

The `Agent` tab is split into two panes:
- Left pane: session sidebar.
- Right pane: selected run chat.

The split should fill the full available tab content width. On slice detail, the existing slice metadata/status sidebar remains outside this surface and unchanged; the new split fills only the right tab container.

If there are no runs with visible transcript content, show a quiet empty state: `No agent runs yet.`

## Session Sidebar

The sidebar lists individual stored run attempts, newest first.

Each row shows:
- Primary label: agent/profile name, e.g. `RepoSetter`, `Worker`.
- Secondary line: latest visible message excerpt so repeated profile names can be distinguished.
- Metadata: status, CLI, relative time.

Active/unarchived runs are shown in the main list.

Archived runs move to a pinned bottom `Archived` section:
- Collapsed by default.
- Expandable.
- If the URL deep-links to an archived run, expand `Archived` and select it.

Delete removes a run from the sidebar immediately after success.

Archive keeps the run available, but moves it to the archived section immediately after success.

## Selection

The selected run is reflected in the URL:

```text
?tab=agent&run=<runId>
```

This applies to both project and slice detail routes.

Default selection:
- If `run=<runId>` is present and exists, select it.
- If the URL run is archived, expand the archived section.
- Otherwise, select the newest run with visible transcript content.
- Runs with only empty/setup/system-only history do not auto-open.

After archiving or deleting the selected run:
- Clear selection.
- Show the quiet placeholder in this visit.
- If the user leaves and returns to the tab later, default selection again opens the newest visible run.

## Chat Pane

The chat pane reuses the existing board chat UI style:
- Same transcript styling.
- Same expandable tool call/detail blocks.
- Same attachment support where existing runtime support makes this cheaper than removing it.

The selected run header shows:
- Run name/profile.
- Status.
- CLI/model/time metadata.
- Existing Stop, Archive, Delete actions.

Do not show a raw logs button.

Do not show a Refresh button. Use live updates and automatic reloads after selecting, sending, stopping, archiving, or deleting.

## Interaction

The composer sends follow-up messages by resuming the selected run.

If the selected run is active/running:
- Keep the composer usable.
- Sending queues the message for the next follow-up.
- The queued user message appears immediately as a pending user bubble.
- Stop remains a separate action.

If the selected run is not active:
- Sending starts a resume/follow-up immediately.
- The user message appears immediately as pending.

## Transcript Loading

Load all logs for the selected run.

Use virtualization only if it is already part of the reused chat machinery; do not add pagination in this feature.

Visible transcript content means user, assistant, tool, or error content that renders in the chat transcript. Empty logs and setup/system-only events do not count for default selection.

## Technical Notes

Existing APIs to reuse:
- `fetchRuntimeSubagents()`
- `fetchRuntimeSubagentLogs()`
- `resumeRuntimeSubagent()`
- `interruptRuntimeSubagent()`
- `archiveRuntimeSubagent()`
- `deleteRuntimeSubagent()`
- `subscribeToSubagentChanges()`
- `subscribeToFileChanges()`

Existing UI to reuse:
- `BoardChatLog` / board chat message styles for transcript rendering.
- Existing subagent resume/attachment behavior where practical.

## Acceptance Criteria

- Project `Agent` tab renders the new sidebar+chat UI.
- Slice `Agent` tab renders the new sidebar+chat UI inside the existing slice content area.
- Worktree/unassigned run inspectors still use the old compact run panel.
- Most recent run with visible transcript auto-selects when no `run` URL param is present.
- `?tab=agent&run=<runId>` restores the selected run.
- Archived run deep links expand/select from the archived section.
- Sending while running queues and shows an immediate pending bubble.
- Stop, Archive, and Delete actions work from the selected run header.
- Archive moves selected run to collapsed archived section and clears selection.
- Delete removes selected run and clears selection.
- No Refresh control appears in project/slice Agent tabs.
- No raw logs button appears in project/slice Agent tabs.
