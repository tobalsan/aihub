# aihub projects CLI

`aihub projects` is the CLI command provided by the projects extension and mounted into the gateway CLI:

```
aihub projects <command> [options]
```

It can be run as:

```
pnpm --dir /Users/thinh/code/aihub aihub projects ...
```

Environment:

- `AIHUB_API_URL`: override API base URL (highest precedence).
- `AIHUB_URL`: fallback env alias for API URL.
- `$AIHUB_HOME/aihub.json`: fallback file config, e.g. `{ "apiUrl": "http://..." }`. Default home: `~/.aihub/`.

## Commands

### `aihub projects list`

List projects (frontmatter only).

Options:

- `--status <status>`: filter by status.
- `-j, --json`: JSON output instead of table.

Status values:

- `not_now`, `maybe`, `shaping`, `todo`, `in_progress`, `review`, `ready_to_merge`, `done`.

### `aihub projects agent list`

List all configured AIHub agents (same output as `pnpm aihub agent list`).

### `aihub projects create`

Create a project.

Arguments:

- `[pitch]`: optional pitch body written to `PITCH.md`.

Options:

- `-t, --title <title>`: required. Must contain at least two words.
- `--pitch <content>`: optional pitch content string, `@file`, or `-` for stdin. Mutually exclusive with positional pitch.
- `--status <status>`: initial status.
- `--area <area>`: optional area id. Validated against `GET /api/areas`; invalid values print the valid ids.
- `-j, --json`: JSON output.

### `aihub projects get <id>`

Fetch a single project (frontmatter plus pitch body).

Options:

- `-j, --json`: JSON output.

### `aihub projects update <id>`

Update project fields and/or project docs content.

Options:

- `--title <title>`: update title (renames folder).
- `--status <status>`: `not_now|maybe|shaping|todo|in_progress|review|ready_to_merge|done`.
- `--run-agent <agent>`: agent used by monitoring start.
  - `aihub:<agentId>` (AIHub agent)
  - `cli:claude|cli:codex|cli:pi` (external CLI)
  - Use `aihub projects agent list` to see configured AIHub agents.
- `--run-mode <mode>`: `main-run` or `worktree` (CLI runs only).
  - `main-run`: use the main repo working tree, slug is `main`.
  - `worktree`: create/use a git worktree at `projects/.workspaces/...`, slug required.
- `--repo <path>`: repo path (used by subagents and start prompt).
- `--readme <content>`: raw markdown content for `README.md` (no frontmatter). Use `-` to read from stdin.
- `--specs <content>`: raw markdown content for legacy project-level `SPECS.md`. Use `-` to read from stdin.
- `-j, --json`: JSON output.

Notes:

- To unset optional fields, pass empty string.
- If stdin is piped and neither `--readme` nor `--specs` is provided, piped content is written to legacy project-level `SPECS.md`.

### `aihub projects pitch <id> --from-readme`

Copy the stripped legacy `README.md` body into `PITCH.md`. Refuses to overwrite an existing `PITCH.md` unless `--force` is passed.

### `aihub projects move <id> <status>`

Shortcut for status update.

Options:

- `--agent <name>`: agent name to record in the status change.
- `-j, --json`: JSON output.

### `aihub projects start <id>`

Start a project run.

Options:

- `--agent <agent>`: cli name (e.g. `codex`) or `aihub:<id>`. Defaults to `codex`.
- `--mode <mode>`: `main-run|clone|worktree|none`. Defaults to `clone`.
- `--branch <branch>`: base branch for worktree. Defaults to `main`.
- `--slug <slug>`: slug override for worktree. Defaults to auto-slug.
- `--subagent <name>`: resolve a named subagent config from `aihub.json` and apply its locked defaults.
- `--prompt-role <role>`: prompt role override (`coordinator|worker|reviewer|legacy`).
- `--allow-overrides`: allow explicit overrides for fields locked by `--subagent`.
- `--include-default-prompt`: force-enable default project prompt context.
- `--exclude-default-prompt`: force-disable default project prompt context.
- `--include-role-instructions`: force-enable role instruction block.
- `--exclude-role-instructions`: force-disable role instruction block.
- `--include-post-run`: force-enable post-run block.
- `--exclude-post-run`: force-disable post-run block.
- `--custom-prompt <prompt>`: one-off prompt (use `-` for stdin).
- `-j, --json`: JSON output.

Subagent config mapping (`--subagent`) comes from the top-level `subagents` array in `aihub.json`.
Each config can define `name`, `description`, `cli`, `model`, `reasoning`, `type`, and `runMode`.
The web spawn form and `aihub projects start --subagent <name>` both resolve through that same config source.

Any explicit locked-field override requires `--allow-overrides`.
Lead-agent launches use `--agent aihub:<id>` and run in project-scoped sessions.

- `--mode <mode>`: `main-run|worktree`.
- `--branch <branch>`: base branch for worktree mode.
- `-j, --json`: JSON output.

### `aihub projects resume <id>`

Resume an existing run (same as sending a message in the monitoring panel).
Resume sends only the follow-up message delta to the harness (no project summary re-prepend).

Options:

- `-m, --message <message>`: required. Use `-` for stdin.
- `--slug <slug>`: override slug for CLI worktree resumes.
- `-j, --json`: JSON output.

### `aihub projects status <id>`

Show run status and recent messages.

Options:

- `--limit <n>`: number of recent messages (default 10).
- `--slug <slug>`: override slug for CLI worktree status.
- `-j, --json`: JSON output.

### `aihub projects archive <id>`

Archive a project.

Options:

- `-j, --json`: JSON output.

### `aihub projects unarchive <id>`

Unarchive a project.

Options:

- `-j, --json`: JSON output.

## Examples

```bash
# Create with pitch
aihub projects create -t "Add kill tool" "Implement a kill command for subagents"

# Create with pitch from file
aihub projects create -t "Add kill tool" --pitch @PITCH.md

# Update run metadata
aihub projects update PRO-19 --run-agent cli:codex --repo ~/code/aihub --run-mode worktree

# Update README via stdin
cat README.md | aihub projects update PRO-19 --readme -

# Update SPECS via stdin
cat SPECS.md | aihub projects update PRO-19 --specs -

# Migrate legacy README prose into PITCH.md
aihub projects pitch PRO-19 --from-readme

# Default stdin update target is SPECS.md
cat SPECS.md | aihub projects update PRO-19

# Start a run with a custom prompt
aihub projects start PRO-19 --custom-prompt "Focus on the rollout plan."

# Start a run with per-run config
aihub projects start PRO-19 --agent codex --mode worktree --branch main --slug my-run

# Start a config-defined Worker subagent run
aihub projects start PRO-19 --subagent Worker --slug worker-task-a

# Start a config-defined Reviewer subagent run
aihub projects start PRO-19 --subagent Reviewer --slug reviewer-task-a

# Start a lead-agent run on a configured AIHub agent
aihub projects start PRO-19 --agent aihub:cloud --custom-prompt "Plan the rollout."

# Resume with a follow-up message
aihub projects resume PRO-19 --message "Continue from where you left off."

# Status with last 5 messages
aihub projects status PRO-19 --limit 5

# Archive a project
aihub projects archive PRO-19

# Unarchive a project
aihub projects unarchive PRO-19

```
