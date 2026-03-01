# Agent Interfacing Specs

Date: 2026-01-25

## Goals
- Live coding agent monitoring in project detail view (monitoring pane).
- Allow main agents to dispatch subagents; monitor subagents (status/logs/diffs).
- Combine AIHub session model with Subtask‑style worktrees + file‑based event sourcing.

---

## Data Model

### Project Frontmatter (README.md)
Add fields (optional unless noted):

```yaml
sessionKeys:
  <agentId>: "project:<id>:<agentId>"
repo: "/abs/path/to/repo"           # required when domain=coding
runAgent: "aihub:<agentId>"        # or "cli:claude|codex|pi"
runMode: "main-run|worktree"       # only for cli agents
```

Notes:
- `sessionKeys` stored in frontmatter for persistence across devices.
- `runAgent`/`runMode` persisted to keep monitoring pane selection stable.

### Workspaces Layout
Root: `{projects.root}/.workspaces/PRO-<id>/`

```
.workspaces/
  PRO-<id>/
    main/                         # external CLI main-run (no worktree)
      state.json
      history.jsonl
      progress.json
      logs.jsonl
    <slug>/                        # subagent or main worktree mode
      state.json
      history.jsonl
      progress.json
      logs.jsonl
```

### state.json (extended subtask schema)
```json
{
  "session_id": "...",
  "supervisor_pid": 12345,
  "started_at": "2026-01-25T...Z",
  "last_error": "",
  "cli": "claude|codex|pi",
  "run_mode": "main-run|worktree",
  "worktree_path": "/abs/path" ,
  "base_branch": "main"
}
```

### history.jsonl (Subtask event schema)
Events (append only):
- `worker.started`
- `worker.finished` (outcome: replied|error)
- `worker.interrupt`

### progress.json
```json
{
  "last_active": "2026-01-25T...Z",
  "tool_calls": 12
}
```
- Update `last_active` on **any log output**.

### logs.jsonl
Raw CLI stdout stream (JSONL where supported). Keep raw lines to allow re‑parse.

---

## Session Keys (AIHub agents)
- sessionKey format: `project:<id>:<agentId>`.
- On first Start for aihub agent, set in frontmatter `sessionKeys[agentId]`.

---

## CLI Harnesses

### Supported CLIs
- **claude**: `claude -p "<prompt>" --output-format stream-json`
- **pi**: `pi --mode json "<prompt>"`
- **codex**: `codex exec "<prompt>" --json`

### Resume / Follow‑up
- Keep `session_id` in state.json.
- Resume flags (from `session_resume.md`):
  - claude: `-r <session_id> -p "..."` (or `-c` continue last)
  - pi: `pi --mode json --session <session_file> "..."`
  - codex: `codex exec --json ... resume <session_id> <prompt>`

### CLI Resolution
- Subtask style: PATH + common install locations + login shell fallback.

---

## Worktrees

### Base Branch
- UI provides base‑branch dropdown (per run, not persisted).
- Default to `main`.

### Branch Naming
- Worktree branch name: `PRO-<id>/<slug>`.
- Slug required; collision error.

### Run Modes
- **main-run**: run in repo path directly, no worktree; still logs under `.workspaces/PRO-<id>/main`.
- **worktree**: create worktree under `.workspaces/PRO-<id>/<slug>`.

---

## Prompts

### Start Prompt (main agent + subagents)
```
Let's tackle the following project:

<title>
<status>
<README body>

You can spawn subagents:
- subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch? }
- subagent.status { projectId, slug }
- subagent.logs { projectId, slug, since }
- subagent.interrupt { projectId, slug }
```

### Follow‑up
- Only user message (no re‑summary).
- Subagent spawn auto‑prepends same project summary to prompt.

---

## APIs

### AIHub Agent Session
- Use existing `/ws` + `/api/agents/:id/history` with sessionKey.

### Subagents (New)

#### List subagents
`GET /api/projects/:id/subagents`

Response:
```json
{
  "items": [
    {
      "slug": "research/realtime-arch",
      "cli": "claude",
      "runMode": "worktree",
      "status": "running|replied|error|idle",
      "lastActive": "2026-01-25T...Z",
      "baseBranch": "main",
      "worktreePath": "/abs/path"
    }
  ]
}
```

#### Logs stream (poll)
`GET /api/projects/:id/subagents/:slug/logs?since=<byte>`

Response:
```json
{
  "cursor": 12345,
  "events": [
    {
      "ts": "2026-01-25T...Z",
      "type": "stdout|stderr|tool_call|tool_output|diff|message|error|session",
      "text": "...",
      "tool": { "name": "rg", "id": "..." },
      "diff": { "path": "...", "summary": "..." }
    }
  ]
}
```

Notes:
- `cursor` = byte offset into `logs.jsonl`.
- Server parses raw JSONL into normalized events; on parse failure emit `type=stdout` with raw line.

#### Branch list
`GET /api/projects/:id/branches`

Response:
```json
{ "branches": ["main", "dev", "feature/x"] }
```

---

## Tools (AIHub agents)

Tools available to Pi + Claude SDK agents:

- `subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch? }`
- `subagent.status { projectId, slug }`
- `subagent.logs { projectId, slug, since }`
- `subagent.interrupt { projectId, slug }`

Notes:
- `projectId` required (simple, no auth).
- `mode` default `worktree`; allow `main-run`.
- `slug` required; collision error.

---

## CLI (for external main agents)

Provide `aihub subagent` commands (shell‑callable):

- `aihub subagent spawn --project <id> --slug <slug> --cli <claude|codex|pi> --prompt "..." [--mode worktree|main-run] [--base <branch>]`
- `aihub subagent status --project <id> --slug <slug>`
- `aihub subagent logs --project <id> --slug <slug> [--since <byte>]`
- `aihub subagent interrupt --project <id> --slug <slug>`

Default `--mode` = `worktree`.

---

## Monitoring UI (Kanban Detail)

### Main agent panel
- Dropdown: `runAgent` (aihub agents + cli agents).
- Dropdown: `runMode` (main-run|worktree) for cli agents only.
- Start button (disabled if missing repo for cli agents).
- Follow‑up input (TUI‑style).
- Tabs: Logs / Diffs.
  - AIHub agent: Logs only; Diffs empty/hidden.
  - External CLI: Logs + Diffs.

### Subagents panel
- Subagent list (slug, cli, status, last active).
- Click row to open logs + diff stats (computed on open).
- Activity updates via `progress.json`.

---

## Status Derivation (Subtask‑style)
- Running if supervisor PID alive and not stale.
- Error if `last_error` present or last history outcome is error.
- Replied if last history outcome is replied.
- Idle if no history yet.

---

## Performance
- Poll subagent list + logs every 2s (subtask default).
- Cursor = byte offset for fast log tailing.
- Diff stats computed on demand (row open).

---

## Out of Scope (v1)
- Auth/permissions for tools.
- Drag/drop, filters, search (kanban).
- Persisting base branch selection.
