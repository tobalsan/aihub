# apm CLI

`apm` is the standalone AIHub projects CLI package (`@aihub/cli`):

```
apm <command> [options]
```

It can be run as:

```
pnpm --dir /Users/thinh/code/aihub apm ...
```

Environment:

- `AIHUB_API_URL`: override API base URL (highest precedence).
- `AIHUB_URL`: fallback env alias for API URL.
- `~/.aihub/config.json`: fallback file config, e.g. `{ "apiUrl": "http://..." }`.

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

Arguments:

- `[description]`: optional description for the README body.

Options:

- `-t, --title <title>`: required. Must contain at least two words.
- `--domain <domain>`: optional domain (`life|admin|coding`).
- `--owner <owner>`: optional owner string.
- `--execution-mode <mode>`: `subagent|ralph_loop`.
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
- `--execution-mode <mode>`: `subagent|ralph_loop`.
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

- `--agent <name>`: agent name to record in the status change.
- `-j, --json`: JSON output.

### `apm start <id>`

Start a project run.

Options:

- `--agent <agent>`: cli name (e.g. `codex`) or `aihub:<id>`. Defaults to `codex`.
- `--mode <mode>`: `main-run` or `worktree`. Defaults to `worktree`.
- `--branch <branch>`: base branch for worktree. Defaults to `main`.
- `--slug <slug>`: slug override for worktree. Defaults to auto-slug.
- `--custom-prompt <prompt>`: one-off prompt (use `-` for stdin).
- `-j, --json`: JSON output.

### `apm ralph <id>`

Start a Ralph loop run.

Options:

- `--cli <cli>`: `codex|claude` (default `codex`).
- `--iterations <n>`: loop iterations (default `20`).
- `--prompt-file <path>`: prompt file path (default project `prompt.md`).
- `--mode <mode>`: `main-run|worktree`.
- `--branch <branch>`: base branch for worktree mode.
- `-j, --json`: JSON output.

### `apm resume <id>`

Resume an existing run (same as sending a message in the monitoring panel).

Options:

- `-m, --message <message>`: required. Use `-` for stdin.
- `--slug <slug>`: override slug for CLI worktree resumes.
- `-j, --json`: JSON output.

### `apm status <id>`

Show run status and recent messages.

Options:

- `--limit <n>`: number of recent messages (default 10).
- `--slug <slug>`: override slug for CLI worktree status.
- `-j, --json`: JSON output.

### `apm archive <id>`

Archive a project.

Options:

- `-j, --json`: JSON output.

### `apm unarchive <id>`

Unarchive a project.

Options:

- `-j, --json`: JSON output.

### `apm subagent spawn`

Spawn a new subagent run directly.

Options:

- `-p, --project <id>`: required. Project ID.
- `-s, --slug <slug>`: required. Subagent slug.
- `-c, --cli <cli>`: required. CLI to use (`claude|codex|droid|gemini`).
- `--prompt <text>`: required. Prompt to send.
- `--mode <mode>`: run mode (`worktree|main-run`).
- `--base <branch>`: base branch for worktree mode.
- `--resume`: resume existing session instead of creating new.

### `apm subagent status`

Get status of a subagent run.

Options:

- `-p, --project <id>`: required. Project ID.
- `-s, --slug <slug>`: required. Subagent slug.

### `apm subagent logs`

Get logs from a subagent run.

Options:

- `-p, --project <id>`: required. Project ID.
- `-s, --slug <slug>`: required. Subagent slug.
- `--since <cursor>`: byte cursor (default: 0).

### `apm subagent interrupt`

Interrupt a running subagent (sends SIGTERM).

Options:

- `-p, --project <id>`: required. Project ID.
- `-s, --slug <slug>`: required. Subagent slug.

### `apm subagent kill`

Kill a subagent and clean up its workspace.

Options:

- `-p, --project <id>`: required. Project ID.
- `-s, --slug <slug>`: required. Subagent slug.

## Examples

```bash
# List coding projects
apm list --domain coding

# Create with description
apm create -t "Add kill tool" --domain coding "Implement a kill command for subagents"

# Update run metadata
apm update PRO-19 --run-agent cli:codex --repo ~/code/aihub --run-mode worktree

# Update README via stdin
cat README.md | apm update PRO-19 --content -

# Start a run with a custom prompt
apm start PRO-19 --custom-prompt "Focus on the rollout plan."

# Start a run with per-run config
apm start PRO-19 --agent codex --mode worktree --branch main --slug my-run

# Resume with a follow-up message
apm resume PRO-19 --message "Continue from where you left off."

# Status with last 5 messages
apm status PRO-19 --limit 5

# Archive a project
apm archive PRO-19

# Unarchive a project
apm unarchive PRO-19

# Spawn a subagent directly
apm subagent spawn -p PRO-19 -s my-run -c codex --prompt "Implement feature X" --mode worktree --base main

# Check subagent logs
apm subagent logs -p PRO-19 -s my-run --since 0

# Interrupt a running subagent
apm subagent interrupt -p PRO-19 -s my-run
```
