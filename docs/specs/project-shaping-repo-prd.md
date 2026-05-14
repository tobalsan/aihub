# Project Shaping Repo Guard PRD

## Goal

Prevent projects from entering the Shaping lifecycle group unless they have an explicit project-level repository path, and make project creation collect or default that repository path earlier.

## Requirements

- Block moves to `shaping` and every `shaping:*` status when `project.frontmatter.repo` is unset or blank.
- Area-inherited repositories do not satisfy this move rule.
- Kanban drag/drop must snap the card back and show an explicit error toast.
- `aihub projects move ...` must fail with an explicit error message.
- Project creation may still leave `repo` empty; the move rule is the guard.
- Kanban project creation always shows a repo text input.
- When the selected area has `repo`, prefill the repo input from that area.
- The repo input remains editable, and the submitted value is stored as project-level `repo`.
- Once the user edits the repo input, later area changes must not overwrite it.
- The repo input validates in the background on blur through a dedicated API endpoint.
- Repo validity uses existing project helper semantics: a valid repo path exists and contains `.git`.
- Repo validation feedback has three states: neutral before blur or when empty, valid `Git repo found`, invalid `Path is not a git repo`.
- Invalid repo feedback must not block project creation.
- `aihub projects create --area <area-with-repo>` copies the area repo into project `repo`.
- `aihub projects create --area <area-with-repo> --repo <repo>` stores the explicit `--repo` value.

## Non-Goals

- Do not validate repo paths with `git rev-parse`.
- Do not make inherited area repo count as project-level repo for Shaping moves.
- Do not block project creation for missing or invalid repo paths.
- Do not change slice repo invariants.

## Acceptance Checks

- Store/API tests reject `status: "shaping"` and `status: "shaping:<stage>"` updates when project repo is missing.
- Board move tests reject moves into the Shaping group when project repo is missing.
- CLI create tests show area repo defaulting, with explicit `--repo` taking precedence.
- Web tests show repo input prefill/edit behavior and validation feedback.
- CLI move reports the explicit backend error.
