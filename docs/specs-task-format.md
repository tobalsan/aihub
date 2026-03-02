# SPECS Task/Acceptance Format Guide

This guide defines the markdown shape that AIHub project detail uses to parse and render `Tasks` and `Acceptance Criteria` from `SPECS.md`.

Use this format when writing or updating project specs.

## Required Sections

Use exact H2 headings:

```md
## Tasks
...

## Acceptance Criteria
...
```

Notes:
- Parsing for Tasks is strict and expects the heading line to be exactly `## Tasks` (case-insensitive).
- Parsing stops at the next H2 heading (`## ...`).
- Inside each section, optional H3 subgroup headings are supported (for example `### Backend`, `### Frontend`, `### Happy Path`).

## Tasks Format (Strict)

Each task line must follow this structure:

```md
- [ ] **Task title** `status:todo`
```

Allowed checkbox markers:
- `- [ ]` for unchecked
- `- [x]` for checked (lowercase `x` for backend parsing)

Required title format:
- Title must be wrapped in bold: `**...**`

Optional metadata (inline, backticked):
- `` `status:todo` ``, `` `status:in_progress` ``, or `` `status:done` ``
- `` `agent:<agent-id>` ``

Description lines:
- Put description on following lines with at least 2-space indent.
- You can group tasks with optional H3 headings under `## Tasks`.

Example:

```md
## Tasks

### Backend

- [ ] **Implement project task parser** `status:in_progress` `agent:codex-worker-1`
  Parse `## Tasks` and return typed items.
  Preserve order and markdown outside the section.

### Frontend

- [x] **Add tests for parser edge cases** `status:done`
  Cover missing section and section replacement behavior.
```

## Acceptance Criteria Format

Acceptance Criteria in project detail are parsed as checkbox list items under `## Acceptance Criteria`.

Use this structure:

```md
## Acceptance Criteria

### Happy Path

- [ ] Criteria statement

### Edge Cases

- [x] Another criteria statement
```

Recommendations:
- Keep acceptance criteria as plain checkbox text (no task metadata needed).
- Keep each criterion on one checkbox line when possible.
- Use optional H3 subgroup headings when lists get long.

## Common Mistakes That Break Parsing

- Using a different heading like `## Task` or `### Tasks`.
- Adding subsection headings outside `## Tasks` or `## Acceptance Criteria`.
- Omitting bold around task title (for Tasks parsing).
- Using uppercase `[X]` in Tasks (backend parser only accepts lowercase `x`).
- Nesting task items under another list or blockquote.
- Putting unindented description lines directly under a task (they won't be attached to that task).

## Quick Template

```md
# <Project Title>

## Context
<free-form spec content>

## Tasks

### Backend

- [ ] **Task one** `status:todo`
  Optional detail line 1.
  Optional detail line 2.

### Frontend

- [ ] **Task two** `status:todo` `agent:<agent-id>`

## Acceptance Criteria

### Happy Path

- [ ] Criterion one

### Edge Cases

- [ ] Criterion two
```
