# Agent Interfacing Decisions

Date: 2026-01-25

## Context
Goal: design live agent monitoring in project card details (monitoring pane) + subagent dispatch/monitoring. Two reference approaches: Vibe Kanban (process+WS streaming) and Subtask (event sourcing + file polling + worktrees). We’ll blend both.

## Decisions (Interview Log)

### Main agent in monitoring pane
- Monitoring pane selects from configured AIHub agents, but **new runs**, not reusing `main` chat sessions.
- Use **sessionKey per project per agent** (new sessions, same session system).
  - sessionKey format: `project:<id>:<agentId>`.
  - mapping stored in frontmatter.
- Start button triggers agent run; start prompt includes project title/status/body.
- Follow‑ups supported (same sessionKey); input box (TUI‑style). Follow‑ups send only user message (no re‑summary).
- Main agent UI should be **Full mode** (thinking/tool calls) but more “coding agent” oriented (tabs: Logs / Diffs).
- For AIHub agents: run in agent’s configured workspace; no diffs.
- Support **external CLI “main agent”** in same dropdown.
  - External main agent runs in project repo (not AIHub agent workspace).
  - Diffs enabled for external main agent.
  - External main agent mode selector: `main-run` vs `worktree`.
    - `main-run`: runs directly on repo, still writes state/history/progress/logs under `.workspaces/PRO-<id>/main`.
    - `worktree`: requires slug; behaves like subagents (worktree).

### Project frontmatter
- Store in frontmatter:
  - `sessionKeys` mapping (agentId -> sessionKey).
  - `repo` path for domain `coding`.
  - `runAgent` (selected agent), `runMode` (main-run|worktree).
- Field names chosen: `sessionKeys`, `repo`, `runAgent`, `runMode`.
- Frontmatter should be hidden in Kanban view (UI).

### External CLI agents
- Supported CLIs (v1): `claude`, `codex`, `pi`.
  - Flags:
    - claude: `claude -p "<prompt>" --output-format stream-json`
    - pi: `pi --mode json "<prompt>"`
    - codex: `codex exec "<prompt>" --json`
- Resume/follow‑up supported for all; store session IDs.
  - codex resume syntax: `codex exec --json ... resume <session_id> <prompt>` (per Subtask).
  - other resume flags per `session_resume.md`.
- CLI resolution: Subtask‑style (PATH + common locations + login shell fallback).
- Parsing: store raw JSONL `logs.jsonl` and parse into normalized events for UI; fallback to raw text if stream‑json unsupported.

### Subagents (external CLI only)
- Subagents are **external CLIs**; AIHub agents only used as main agents.
- Dispatch is **agent‑initiated** via tools; also exposed via CLI so external main agents can call shell.
- Worktrees under per‑project pool:
  - root: `{projects.root}/.workspaces/PRO-<id>/`.
  - slug required; collision = error.
  - branch naming: `PRO-<id>/<slug>`.
- Base branch selectable per run (UI dropdown), not persisted.
- Subagents reuse **same worktree + session id** across follow‑ups (same slug).
- Subagents can run in `main` too (mode). Default `worktree`.
- Activity timestamp updates on **any log output** (not only tool calls).
- Subagent list in UI (slug, cli, status, activity). Click row to open logs.
  - “Changes” (diff stats) computed **on row open** only.

### Files + status tracking (Subtask‑style)
- Per subagent (and external main agent) use Subtask‑style files under workspaces:
  - `state.json` (extended with `cli`, `runMode`, `worktreePath`, `baseBranch`)
  - `history.jsonl` (Subtask event schema)
  - `progress.json` (LastActive, tool calls count)
  - `logs.jsonl` (raw CLI stdout JSONL)
- Status derived via event sourcing + PID liveness + last error (Subtask pattern).
- Polling (no WS) for subagent list/logs (Subtask‑like). 2s interval (subtask default).

### API + tools
- Add API endpoints for subagents:
  - `GET /api/projects/:id/subagents` (status list)
  - `GET /api/projects/:id/subagents/:slug/logs?since=<byte>` (normalized events, with byte cursor)
- `since` cursor = byte offset (fastest).
- Tools for main agents (Pi + Claude SDK):
  - `subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch? }`
  - `subagent.status { projectId, slug }`
  - `subagent.logs { projectId, slug, since }`
  - `subagent.interrupt { projectId, slug }`
- Auth: none (keep simple).
- Expose subagent tool calls in monitoring UI (full observability).

### Start prompt content
- Start prompt template:
  - “Let’s tackle the following project:”
  - title
  - status
  - README body
  - plus tool usage doc for subagent CLI/tools (short bullet list).
- Subagent spawn auto‑prepends same project summary before prompt.

## Open Items
- Exact CLI resume flags for claude/codex/pi to codify.
- UI design specifics for tabs + log rendering.
