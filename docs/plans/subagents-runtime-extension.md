# Subagents Runtime Extension Spec

## Problem

AIHub currently has useful subagent lifecycle management, but it is owned by the `projects` extension. That makes `projects` responsible for process spawning, CLI harness behavior, logs, state, resume, interrupt, kill, archive, and project management. It also leaves the `aihub projects` CLI as a separate project-specific command surface.

This should be split:

- `projects` focuses on project management: areas, kanban, project files, project status, prompt construction, and project-specific workspace policy.
- `subagents` focuses on runtime: starting, resuming, observing, interrupting, archiving, and deleting CLI-backed subagent runs.
- `aihub` becomes the command host. Extension commands live under the main `aihub` binary.

## Goals

- Create a built-in `subagents` extension, enabled by default like core runtime behavior.
- Make subagent runs project-agnostic and reusable by any extension.
- Move subagent profiles from top-level config into `extensions.subagents.profiles`.
- Store subagent session data under `$AIHUB_HOME/sessions/subagents/runs/<runId>`.
- Replace `aihub projects start ...` style usage with `aihub subagents ...` and eventually `aihub projects ...`.
- Let ChatView show subagents scoped to the current chat session/parent.
- Let Board and other extensions show subagent overviews without owning process/runtime logic.
- Keep runtime actions HTTP-backed by default; offline CLI behavior is only for config/validation.

## Non-Goals

- No backward compatibility requirement for old project subagent APIs or storage.
- No migration from existing project `sessions/<slug>` directories.
- No Ralph loop support in MVP.
- No output artifact management in MVP.
- No dynamic external extension CLI registration yet. First-party extension commands are enough.
- No workspace or git policy in the runtime. Host extensions own that.

## Existing State

Current runtime ownership lives mostly in:

- `packages/extensions/projects/src/subagents/runner.ts`
- `packages/extensions/projects/src/subagents/index.ts`
- `packages/extensions/projects/src/index.ts`

Current project-owned routes include:

- `GET /api/projects/:id/subagents`
- `POST /api/projects/:id/subagents`
- `PATCH /api/projects/:id/subagents/:slug`
- `POST /api/projects/:id/subagents/:slug/interrupt`
- `POST /api/projects/:id/subagents/:slug/kill`
- `POST /api/projects/:id/subagents/:slug/archive`
- `POST /api/projects/:id/subagents/:slug/unarchive`
- `GET /api/projects/:id/subagents/:slug/logs`
- `GET /api/subagents`
- `POST /api/projects/:id/ralph-loop`
- `POST /api/projects/:id/start`

The useful extractable pieces are CLI command construction, process lifecycle, session id parsing, state/log persistence, normalized log reading, interrupt/archive/delete, and status derivation.

The project-owned pieces are project lookup, docs/prompt construction, project status transitions, project activity, Space/worktree policy, reviewer workspace discovery, and git integration.

## Configuration

Subagent profiles move under extension config:

```json
{
  "extensions": {
    "subagents": {
      "profiles": [
        {
          "name": "Worker",
          "cli": "codex",
          "model": "gpt-5.3-codex",
          "reasoningEffort": "medium",
          "labelPrefix": "worker"
        }
      ]
    }
  }
}
```

Profiles are convenience defaults, not locked policy. CLI/API overrides are allowed by default.

## Data Model

Run ids are opaque and stable:

```text
sar_<ulid>
```

Run storage:

```text
$AIHUB_HOME/
  sessions/
    subagents/
      runs/
        <runId>/
          config.json
          state.json
          progress.json
          logs.jsonl
          history.jsonl
```

Core run shape:

```ts
type SubagentParent = {
  type: string;
  id: string;
};

type SubagentRun = {
  id: string;
  label: string;
  parent?: SubagentParent;
  cli: "codex" | "claude" | "pi";
  cwd: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  status: "starting" | "running" | "done" | "error" | "interrupted";
  pid?: number;
  cliSessionId?: string;
  startedAt: string;
  lastActiveAt?: string;
  latestOutput?: string;
  finishedAt?: string;
  exitCode?: number;
  lastError?: string;
  archived?: boolean;
};
```

Runtime validates only that `cwd` exists. Host extensions decide whether it must be a git repo, worktree, Space checkout, or anything else.

Labels are unique per parent. Creating another run with the same `parent + label` is rejected unless explicit future replacement semantics are added.

## Parent Scope

Parents are runtime metadata. The subagents extension stores and filters by parent but does not interpret it.

Examples:

```text
projects:PRO-1
agent-session:<agentId>:<sessionKey>
```

ChatView uses exact session isolation. A normal agent chat sees only subagents parented to its `agent-session:<agentId>:<sessionKey>`. A project lead chat sees project-scoped runs such as `projects:PRO-1` when that is the parent passed by the project extension.

Board can use the same parent model. The left-pane conversation can use `agent-session:<agentId>:<sessionKey>` while board-owned work can use a board parent such as `board:<boardId>`. The right pane can choose the narrow session parent for "this conversation" or a wider board parent for "everything active on this board".

## HTTP API

Runtime routes live under `/api/subagents`.

```http
GET    /api/subagents
POST   /api/subagents
GET    /api/subagents/:runId
PATCH  /api/subagents/:runId
POST   /api/subagents/:runId/resume
POST   /api/subagents/:runId/interrupt
POST   /api/subagents/:runId/archive
POST   /api/subagents/:runId/unarchive
DELETE /api/subagents/:runId
GET    /api/subagents/:runId/logs?since=0
```

List supports filters:

```http
GET /api/subagents?parent=projects:PRO-1
GET /api/subagents?parent=agent-session:lead:main
GET /api/subagents?status=running
GET /api/subagents?includeArchived=true
```

Start request:

```json
{
  "cli": "codex",
  "cwd": "/path/to/repo",
  "prompt": "Implement the thing",
  "label": "worker-a",
  "profile": "Worker",
  "model": "gpt-5.3-codex",
  "reasoningEffort": "medium",
  "parent": { "type": "projects", "id": "PRO-1" }
}
```

`profile`, `model`, `reasoningEffort`, and `parent` are optional. `cli`, `cwd`, `prompt`, and `label` are required after profile defaults are applied.

Resume request:

```json
{
  "prompt": "Continue with the next step"
}
```

Resume is rejected while a run is active:

```text
Subagent run is active; interrupt or wait before resuming.
```

Logs stay raw on disk, but the API exposes normalized events for UI/CLI stability.

List/detail responses include `lastActiveAt` and a short `latestOutput` summary derived from normalized logs. This lets ChatView, Board, and other extensions render a quick overview without issuing one log request per run.

## CLI

`aihub` is the command host. First-party extensions register commands at build time.

Runtime commands:

```sh
aihub subagents start --cli codex --cwd /repo --prompt "..." --label worker-a
aihub subagents start --profile Worker --cwd /repo --prompt "..." --label worker-a
aihub subagents list --parent projects:PRO-1
aihub subagents status <runId>
aihub subagents logs <runId> --since 0
aihub subagents resume <runId> --prompt "..."
aihub subagents interrupt <runId>
aihub subagents archive <runId>
aihub subagents unarchive <runId>
aihub subagents delete <runId>
```

Runtime actions call the gateway HTTP API. Human text is default. `--json` returns machine-readable output for agents/scripts.

Minimum start inputs:

- `--cli <codex|claude|pi>`
- `--cwd <path>`
- `--prompt <text>` or stdin support later
- `--label <label>`
- optional `--model`
- optional `--reasoning-effort`
- optional `--parent <type:id>`

Project commands can later move under:

```sh
aihub projects ...
```

## Events

The subagents extension emits realtime lifecycle events:

```ts
type SubagentChangedEvent = {
  type: "subagent_changed";
  runId: string;
  parent?: { type: string; id: string };
  status: "starting" | "running" | "done" | "error" | "interrupted";
};
```

Web clients refetch run/list/log data after receiving the event. The event is intentionally small.

Output-driven updates should be throttled before broadcasting. MVP can reuse `subagent_changed` for meaningful output/status changes; a separate `subagent_output` event can be added later if consumers need append-only streaming.

## ChatView UX

ChatView shows subagents for the current session parent only.

MVP surface:

- compact status row or drawer near the chat header/composer
- running count
- label, CLI, status, runtime
- latest normalized log line
- actions: view logs, interrupt

Archive/delete can stay outside ChatView or appear in a details menu.

## Board UX

Board can show a subagent overview in its right pane by querying `/api/subagents` with the parent scope it owns.

Useful views:

- current conversation: `GET /api/subagents?parent=agent-session:<agentId>:<sessionKey>`
- current board: `GET /api/subagents?parent=board:<boardId>`
- global active work: `GET /api/subagents?status=running`

MVP surface:

- running count
- label, CLI, status, runtime
- parent/source label when showing mixed scopes
- latest output snippet from `latestOutput`
- actions: view logs, interrupt

Board does not start, monitor, interrupt, or archive processes directly. It calls the subagents runtime API and subscribes to `subagent_changed`.

## Projects Extension After Extraction

`projects` stops importing subagent runner internals.

It remains responsible for:

- project prompt construction
- project docs and status
- Space/worktree/repo policy
- choosing `cwd`
- choosing parent metadata, e.g. `{ type: "projects", id: "PRO-1" }`
- project-specific UI composition

It calls `/api/subagents` or shared subagent service functions to create runtime runs.

If keeping project UX does not add too much plumbing, project screens can continue showing project-scoped subagents by querying:

```http
GET /api/subagents?parent=projects:PRO-1
```

Old project subagent storage and route shapes can be removed.

## Internal Agent Tool

MVP focuses on shell CLI. The API/service boundary should make a future internal tool straightforward:

```ts
subagents.start({
  cli,
  cwd,
  prompt,
  label,
  model,
  reasoningEffort,
  parent,
});
```

The internal tool should call the same runtime service as the HTTP API and CLI.

## Open Risks

- Extension CLI registration does not exist yet; first implementation needs a simple first-party command registration seam in `aihub`.
- Current `/api/capabilities` reports loaded extension ids, not capability strings. Web gating may need a small update for `subagents`.
- Existing project activity currently reads project-owned subagent state. After extraction it should either subscribe to `subagent_changed` or query `/api/subagents?parent=projects:*`.
- Process tree cleanup must avoid deleting run records on interrupt. `interrupt`, `archive`, and `delete` stay separate.
- Status naming should be normalized; avoid the current `replied` versus `idle` mismatch.
