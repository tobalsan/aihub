---
title: Projects UI Refresh
labels:
  - needs-triage
status: draft
created: 2026-05-08
---

# Projects UI Refresh PRD

## Problem Statement

The Projects extension home and detail experience has fallen behind the newer Board extension lifecycle UI. The current Projects home still presents an old project kanban with legacy project statuses such as `not_now`, `maybe`, `todo`, `in_progress`, and `review`, even though the product model has shifted toward projects as lifecycle containers and slices as the execution kanban unit.

As a user, this creates friction: new projects do not start in the right place, project creation still treats README-style content as the main document, the kanban expansion behavior is artificially limited, archived projects occupy space on the main page, and clicking a project opens the old three-pane detail UI instead of the newer Pitch/Slices/Thread/Activity lifecycle experience already available in the Board extension.

## Solution

Refresh the Projects extension UI around the current lifecycle model while leaving the Board extension UI untouched.

The Projects home will show a simplified project kanban with exactly five visible lifecycle columns: Triage, Shaping, Active, Ready to merge, and Done. Project statuses will be simplified to exactly `triage`, `shaping`, `active`, `ready_to_merge`, `done`, and `cancelled`. New projects will default to `triage` unless another status is explicitly provided, such as via CLI.

Archived and cancelled projects will no longer appear in a top section on the Projects home. Instead, a dedicated `/projects/archive` page will list them grouped by Archived and Cancelled.

Project creation will continue using the existing lightweight form shape, but the main body text entered in the UI will be persisted to `README.md` as the initial idea/prompt. Shaping agents can then use that README context to create and iterate on `PITCH.md`. The area selector will become an autocomplete search input. If no existing area matches the typed text, the form will offer `+ Create "<area>"`; selecting it only marks a pending new area, and the actual area is created when the project form is submitted.

Clicking a project from the Projects kanban will open the Board-style project detail experience under Projects routes, preserving the left navigation shell and removing the old project detail UI and right sidebar. The detail page will expose Pitch, Slices, Thread, and Activity tabs, with slice details rendered inline under the Slices tab.

## User Stories

1. As a project owner, I want new projects to land in Triage by default, so that unreviewed ideas enter a clear intake lane.
2. As a project owner, I want the Projects kanban to show only current lifecycle statuses, so that I do not have to interpret outdated workflow labels.
3. As a project owner, I want `Maybe` to be replaced by `Triage`, so that the first column reflects actionable intake rather than vague intent.
4. As a project owner, I want `todo`, `in_progress`, and `review` projects to be represented as Active projects, so that execution detail moves to slices instead of project-level statuses.
5. As a project owner, I want old `not_now` and `maybe` projects to appear in Triage, so that legacy projects remain visible after the refresh.
6. As a project owner, I want old `todo`, `in_progress`, and `review` projects to appear in Active, so that legacy work stays findable.
7. As a project owner, I want Ready to merge to remain available as a project status, so that projects near completion can be distinguished.
8. As a project owner, I want Done to remain visible on the kanban, so that completed projects can be reviewed without going to archive.
9. As a project owner, I want Cancelled projects to be a real project status, so that cancelled work is represented explicitly.
10. As a project owner, I want cancelled projects excluded from the main kanban, so that active planning space stays focused.
11. As a project owner, I want archived projects excluded from the main kanban, so that stale work does not clutter the project home.
12. As a project owner, I want a dedicated archive page, so that I can inspect non-active projects when I choose to.
13. As a project owner, I want archived and cancelled projects grouped separately on the archive page, so that I can distinguish intentionally archived work from cancelled work.
14. As a project owner, I want the existing Archived button/link to lead to the new archive page, so that the navigation remains familiar.
15. As a project owner, I want to expand any number of kanban columns, so that I can inspect the board in the layout that fits my current task.
16. As a project owner, I want expanded column state persisted, so that my preferred board layout survives refreshes.
17. As a project owner, I want no hidden limit forcing only two columns expanded, so that the UI does not unexpectedly collapse columns I am using.
18. As a project creator, I want the quick-create form to remain lightweight, so that creating projects stays fast.
19. As a project creator, I want the create form body to write to `README.md`, so that shaping agents have my initial idea/prompt available before they create or refine `PITCH.md`.
20. As a project creator, I want README to remain metadata-oriented, so that document responsibilities stay clear.
21. As a CLI user, I want explicit status values passed during project creation to still be honored, so that scripted workflows remain possible.
22. As a project creator, I want to search existing areas while creating a project, so that selecting an area is faster than scanning a dropdown.
23. As a project creator, I want to create a new area from the area field when none matches, so that I do not need to leave the form.
24. As a project creator, I want clicking `+ Create "Area"` to select a pending new area without immediately creating it, so that abandoned forms do not create stray areas.
25. As a project creator, I want the pending new area to be created only when the project form submits successfully, so that area creation is transactional with project creation.
26. As a project creator, I want generated new areas to have sensible defaults, so that quick creation does not require a modal.
27. As a project owner, I want clicking a project on the Projects kanban to open the new lifecycle detail page, so that Projects and Board use the same project detail model.
28. As a project owner, I want the project detail page to show Pitch, Slices, Thread, and Activity tabs, so that project work is organized around current concepts.
29. As a project owner, I want the Pitch tab to edit `PITCH.md`, so that the main project narrative is easy to maintain.
30. As a project owner, I want the Slices tab to show project slices, so that implementation work is managed at the slice level.
31. As a project owner, I want slice details to open inline under the Slices tab, so that I keep project context while drilling into a slice.
32. As a project owner, I want Thread to show project comments, so that discussion remains attached to the project.
33. As a project owner, I want Activity to show project activity, so that I can review recent lifecycle and agent events.
34. As a project owner, I want the left sidebar to remain visible on Projects detail routes, so that global navigation is consistent.
35. As a project owner, I do not want the old right sidebar on Projects detail routes, so that the refreshed detail page is focused and consistent with lifecycle views.
36. As a project owner, I do not want the old left-pane agent chat list / center tab / document viewer layout, so that Projects no longer exposes stale detail UI.
37. As a project owner, I want `/projects/:projectId` to open the Pitch tab by default, so that project narrative is the first view.
38. As a project owner, I want `/projects/:projectId?tab=slices` to open the Slices tab, so that tab URLs are shareable.
39. As a project owner, I want `/projects/:projectId?tab=thread` to open the Thread tab, so that discussion URLs are shareable.
40. As a project owner, I want `/projects/:projectId?tab=activity` to open the Activity tab, so that activity URLs are shareable.
41. As a project owner, I want `/projects/:projectId/slices/:sliceId` to open inline slice detail, so that slice URLs work outside the Board route.
42. As a project owner, I want slice sub-tabs to remain addressable under Projects routes, so that Specs, Tasks, Validation, Thread, and Agent views can be linked.
43. As a Board user, I want the current Board extension UI left untouched, so that this refresh does not regress the existing Board home experience.
44. As a maintainer, I want the Board-style project detail component reused through an adapter, so that duplicated project detail implementations do not diverge.
45. As a maintainer, I want status normalization and project creation behavior isolated behind testable seams, so that lifecycle rules are not scattered through UI code.
46. As a maintainer, I want existing legacy projects to remain readable, so that the UI refresh does not require manual cleanup before use.
47. As a maintainer, I want documentation updated after implementation, so that future agents understand the current Projects lifecycle model.

## Implementation Decisions

- Project statuses will be simplified to exactly `triage`, `shaping`, `active`, `ready_to_merge`, `done`, and `cancelled`.
- The project creation default status will change from the prior lifecycle default to `triage` unless an explicit status is provided.
- Legacy project status mapping will be supported as follows:
  - `maybe` and `not_now` normalize to `triage`.
  - `todo`, `in_progress`, and `review` normalize to `active`.
- The Projects kanban will render the five main columns: Triage, Shaping, Active, Ready to merge, and Done.
- Cancelled projects are excluded from the main kanban and shown on the archive page.
- Archived projects remain represented by archive location/state and are shown on the archive page.
- The previous top archived section on the Projects home will be removed.
- The archive navigation will route to `/projects/archive` and show grouped Archived and Cancelled sections.
- The expanded-column persistence logic will allow any number of valid columns instead of truncating to two.
- Project quick creation will persist main form text to `README.md` so shaping agents can use the initial idea/prompt to create or refine `PITCH.md`.
- The area dropdown in the project creation form will be replaced by an autocomplete input over existing areas.
- When typed area text has no matching existing area, the autocomplete will expose a selectable `+ Create "<area>"` option.
- Selecting `+ Create "<area>"` will only set pending form state. It will not create the area immediately.
- Pending new area creation will happen as part of project form submission.
- The project detail route under Projects will reuse the Board lifecycle project detail experience through a routing adapter rather than preserving the old Projects detail page.
- Projects detail URLs will use Projects paths rather than Board paths:
  - `/projects/:projectId`
  - `/projects/:projectId?tab=slices|thread|activity`
  - `/projects/:projectId/slices/:sliceId?tab=specs|tasks|validation|thread|agent`
- The adapter will translate any Board-detail internal navigation to Projects route equivalents.
- The Projects left navigation shell will remain mounted for list, archive, project detail, and slice detail routes.
- The old Projects detail UI, including the agent chat list pane, center chat/activity/changes tabs, document viewer, and right context sidebar, is replaced for project detail navigation.
- The Board extension UI and Board route behavior are explicitly out of bounds for visual changes.
- Documentation updates are required after implementation, especially the LLM context document and a dated handoff note.

### Proposed Modules

- **Project lifecycle/status model**: centralizes allowed project statuses, creation defaults, and legacy normalization.
- **Project creation flow**: owns default status, UI README persistence, and transactional pending-area creation.
- **Projects kanban UI**: owns displayed columns, expanded-column persistence, drag/move behavior, and create affordances.
- **Projects archive page**: owns archived/cancelled project listing and grouping.
- **Projects detail routing adapter**: reuses the Board-style lifecycle detail component under Projects routes while translating navigation.
- **Documentation/handoff updates**: captures the changed lifecycle model for humans and future agents.

## Testing Decisions

Good tests should verify externally observable behavior rather than implementation details. They should assert what users, API callers, or stored project documents observe: visible columns, normalized statuses, created files, route behavior, and submitted payloads. Tests should not depend on private component state or exact internal helper names unless those helpers are intentionally extracted as stable deep modules.

Testing priority:

- Test project status normalization/defaults, including legacy mappings into `triage` and `active`.
- Test project creation from the UI writes user-entered body text to `README.md` and defaults to `triage`.
- Test explicit status remains honored when project creation receives one.
- Test the area autocomplete flow, especially that selecting `+ Create "<area>"` does not create an area until form submit.
- Test successful submit with a pending new area creates/selects that area for the new project.
- Test Projects kanban renders the new five columns and excludes archived/cancelled from the main board.
- Test expanded-column persistence accepts more than two columns and restores them after reload/remount.
- Test `/projects/archive` groups Archived and Cancelled projects separately.
- Test `/projects/:projectId` renders the Board-style lifecycle detail tabs instead of the old detail layout.
- Test Projects detail navigation maps Board-style internal links to `/projects/...` URLs.
- Test `/projects/:projectId/slices/:sliceId` renders inline slice detail under the project detail shell.

Prior art in the codebase includes component tests for the existing Projects board create flow, realtime behavior, true modal behavior, Board project detail routing, Project grouped lifecycle list behavior, and document-store validation. The refreshed tests should follow those patterns where possible.

## Out of Scope

- Redesigning or visually changing the Board extension UI.
- Reworking slice statuses or the slice kanban model.
- Reintroducing project-level execution statuses such as `todo`, `in_progress`, or `review`.
- Building a full area creation modal with color/title editing during project creation.
- Creating areas immediately when the autocomplete `+ Create` option is clicked.
- Rebuilding agent chat, subagent management, or old project-detail right-sidebar functionality in the new detail route.
- Changing the underlying archive storage mechanism beyond exposing archived projects on the dedicated archive page.
- Broad visual redesign beyond the specified Projects refresh.

## Further Notes

The current codebase already contains the Board lifecycle detail experience with Pitch, Slices, Thread, and Activity. The desired implementation should prefer reuse and route adaptation over duplicating that UI.

The product direction is that projects track lifecycle while slices track execution. This PRD intentionally moves the Projects home away from execution-like project statuses and toward intake/lifecycle management.

The archive page should be reachable from the existing Projects header affordance, but its content should no longer consume space on the kanban home.
