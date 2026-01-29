# apm CLI

`apm` is a shortcut to the Projects CLI:
```
apm <command> [options]
```

It calls: `pnpm --dir /Users/thinh/code/aihub projects ...`.

Environment:
- `AIHUB_API_URL`: override API base URL (default derived from gateway config).

## Commands

### `apm list`
List projects (frontmatter only).

Options:
- `--status <status>`: filter by status.
- `--owner <owner>`: filter by owner.
- `--domain <domain>`: filter by domain.
- `-j, --json`: JSON output instead of table.

Status values:
- `not_now`, `maybe`, `shaping`, `todo`, `in_progress`, `review`, `done`.

Domain values:
- `life`, `admin`, `coding`.

### `apm agent list`
List all configured AIHub agents (same output as `pnpm aihub agent list`).

### `apm create`
Create a project.

Options:
- `-t, --title <title>`: required. Must contain at least two words.
- `--domain <domain>`: optional domain (`life|admin|coding`).
- `--owner <owner>`: optional owner string.
- `--execution-mode <mode>`: `manual|exploratory|auto|full_auto`.
- `--appetite <appetite>`: `small|big`.
- `--status <status>`: initial status.
- `-j, --json`: JSON output.

### `apm get <id>`
Fetch a single project (full README).

Options:
- `-j, --json`: JSON output.

### `apm update <id>`
Update project fields and/or README content.

Options:
- `--title <title>`: update title (renames folder).
- `--domain <domain>`: `life|admin|coding`.
- `--owner <owner>`: owner string.
- `--execution-mode <mode>`: `manual|exploratory|auto|full_auto`.
- `--appetite <appetite>`: `small|big`.
- `--status <status>`: `not_now|maybe|shaping|todo|in_progress|review|done`.
- `--run-agent <agent>`: agent used by monitoring start.
  - `aihub:<agentId>` (AIHub agent)
  - `cli:claude|cli:codex|cli:droid|cli:gemini` (external CLI)
  - Use `apm agent list` to see configured AIHub agents.
- `--run-mode <mode>`: `main-run` or `worktree` (CLI runs only).
  - `main-run`: use the main repo working tree, slug is `main`.
  - `worktree`: create/use a git worktree at `projects/.workspaces/...`, slug required.
- `--repo <path>`: repo path (used by subagents and start prompt).
- `--content <content>`: raw markdown content for README (no frontmatter). Use `-` to read from stdin.
- `-j, --json`: JSON output.

Notes:
- To unset optional fields, pass empty string (e.g. `--owner ""`).

### `apm move <id> <status>`
Shortcut for status update.

Options:
- `-j, --json`: JSON output.

## Examples

```
# List coding projects
apm list --domain coding

# Create
apm create --title "Add kill tool" --domain coding --status todo

# Update run metadata
apm update PRO-19 --run-agent aihub:project_manager --repo ~/code/aihub --run-mode worktree

# Update README via stdin
cat README.md | apm update PRO-19 --content -
```
