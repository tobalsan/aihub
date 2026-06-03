# @aihub/extension-orchestrator

Symphony-aligned Linear orchestrator for AIHub.

## AIHub config

AIHub config lists project folders and supervisor limits only:

```json
{
  "extensions": {
    "subagents": {
      "profiles": [{ "name": "worker", "cli": "codex" }]
    },
    "orchestrator": {
      "projects": ["./projects/aihub"],
      "projectsRoot": "~/projects",
      "concurrency": { "global": 3 }
    }
  }
}
```

Each project folder must contain uppercase `WORKFLOW.md`.

### `extensions.orchestrator` schema

Full schema:

```json
{
  "enabled": true,
  "projects": ["./projects/aihub"],
  "projectsRoot": "~/projects",
  "concurrency": { "global": 3 },
  "validation": { "strict": true },
  "notifyChannel": "ops",
  "linear": { "exposeGraphqlTool": true },
  "webhook": {
    "enabled": true,
    "path": "/api/orchestrator/webhook",
    "secret": "$LINEAR_WEBHOOK_SECRET"
  }
}
```

Fields:

- `enabled` optional boolean. Enables/disables extension when present in config.
- `projects` required in practice, optional in schema. Project folders containing `WORKFLOW.md`. Default `[]`.
- `projectsRoot` optional string. Root folder used by `orchestrator init-project` for newly scaffolded projects. Default `~/projects`.
- `concurrency.global` optional positive integer. Max workers across all projects. Default `3` at runtime.
- `validation.strict` optional boolean. Fail startup on invalid configured project. Default `true`.
- `notifyChannel` optional string. Notification channel for HITL/stall/startup errors.
- `linear.exposeGraphqlTool` optional boolean. Expose `orchestrator.linear_graphql` to workers. Default `true`.
- `webhook.enabled` optional boolean. Enables Linear webhook receiver.
- `webhook.path` optional string. Reserved webhook path metadata; route is mounted under `/api/orchestrator/webhook`.
- `webhook.secret` optional string. HMAC secret for Linear webhook verification.

No orchestrator repo map, default repo, worktree, poll interval, or `workspacesRoot` settings live in `aihub.json`. Project runtime settings live in each project `WORKFLOW.md`.

## Create Linear Project + WORKFLOW.md

Bootstrap a Linear project and local orchestrator project folder:

```bash
pnpm aihub:dev orchestrator init-project "Foo Bar" --profile worker
```

The command:

- Reads `extensions.orchestrator.projectsRoot`, defaulting to `~/projects`.
- Creates a Linear project named `Foo Bar`.
- Creates `<projectsRoot>/foo-bar`.
- Writes `WORKFLOW.md` with `tracker.project_slug` set to the created Linear project's `slugId`.
- Appends the project folder path to `extensions.orchestrator.projects` in `$AIHUB_HOME/aihub.json`.

The folder must not already exist and a Linear project with the same name must not already exist. Because project registration is read at gateway startup, restart the gateway after running `init-project`.

## Create WORKFLOW.md

Generate starter workflow explicitly:

```bash
pnpm aihub:dev orchestrator init-workflow \
  --project ./projects/aihub \
  --project-slug aihub \
  --profile worker
```

Options:

- `--project <path>`: project folder to create/update.
- `--project-slug <slug>`: Linear project `slugId` used for polling.
- `--profile <name>`: AIHub subagent profile, default `worker`.
- `--force`: overwrite existing `WORKFLOW.md`.

The generator never creates a global fallback workflow. It only writes project-owned `WORKFLOW.md`.

## WORKFLOW.md configuration

Full example:

```yaml
---
tracker:
  kind: linear
  endpoint: https://api.linear.app/graphql
  api_key: $LINEAR_API_KEY
  project_slug: aihub
  active_states: [Todo, In Progress]
  terminal_states: [Closed, Cancelled, Canceled, Duplicate, Done]
  needs_human: Needs Human
polling:
  interval_ms: 30000
  jitter_ms: 5000
workspace:
  root: ./workspaces
  cleanup_on_terminal: false
  reuse: true
agent:
  profile: worker
  max_concurrent: 3
  max_turns: 10
  stall_timeout_ms: 1800000
hooks:
  after_create: null
  before_run: null
  after_run: null
  before_remove: null
linear:
  exposeGraphqlTool: true
---
You are working on Linear issue {{issue.identifier}}.

## DO THIS FIRST

1. Fetch Linear issue {{issue.identifier}}.
2. If current state is `Todo`, move it to `In Progress`.
3. Add or update one Linear comment signaling you are working on the issue.
4. Continue only after those Linear updates succeed.

Do not perform task work before this claim step.

## Workspace Rule

Work only inside the issue workspace. If repositories are needed, clone or use them inside this workspace unless hooks prepared them already.

## Linear Workflow

Update Linear with concise progress, validation results, and final handoff. Keep one Linear comment updated instead of creating a noisy comment stream.

When the work is complete and validated, move the issue to `In Review`. If you are blocked, move the issue to `Needs Human` and update the comment with the blocker, what you tried, and the decision needed.

## Code Changes and Review Flow

If, and only if, you need to make code changes:

1. Create a worktree from the `main` branch and work there.
2. Spawn a reviewer subagent to run a code review.
3. Do not commit anything until the review comes back clean.
4. Once review is clean, commit inside the worktree, create a PR using `gh`, link the PR to the Linear issue, and move the issue to `In Review`.

## Golden Rule: Clarification Over Assumption

Ask rather than assume when requirements, ownership, or risk are unclear. Involve HITL by updating the Linear comment with the question or blocker and moving the issue to `Needs Human`.
```

### `tracker`

- `kind`: currently only `linear`.
- `endpoint`: Linear GraphQL endpoint. Defaults to `https://api.linear.app/graphql`.
- `api_key`: literal token or `$ENV_VAR`. Usually `$LINEAR_API_KEY`.
- `project_slug`: required Linear project `slugId`. Candidate issues are filtered by this.
- `active_states`: states eligible for worker dispatch. Default `[Todo, In Progress]`.
- `terminal_states`: states that release claims and optionally clean workspaces. Default `[Closed, Cancelled, Canceled, Duplicate, Done]`.
- `needs_human`: exceptional park state. Default `Needs Human`. Orchestrator-owned transitions into this state are hard stops for any active worker run.

### `polling`

- `interval_ms`: base delay between project ticks. Default `30000`.
- `jitter_ms`: random +/- jitter added to interval. Default `5000`.

Each configured project has its own polling schedule.

### `workspace`

- `root`: per-issue workspace root. Default `./workspaces`.
- `cleanup_on_terminal`: remove issue workspace when issue reaches terminal state. Default `false`.
- `reuse`: preserve/reuse existing issue workspace. Default `true`.

Path rules:

- Relative paths resolve relative to the project folder containing `WORKFLOW.md`.
- `~` expands to home.
- `$AIHUB_HOME` and `$AIHUB_HOME/...` are supported.
- Worker cwd is `<workspace.root>/<sanitized-issue-identifier>`.
- Core orchestrator only creates directories. It does not clone repos or create worktrees.

### `agent`

- `profile`: AIHub subagent profile name. Must exist in `extensions.subagents.profiles[]`.
- `max_concurrent`: per-project worker cap. Effective cap also respects `extensions.orchestrator.concurrency.global`.
- `max_turns`: workflow hint for worker prompt/runtime.
- `stall_timeout_ms`: time without observed events before parking/stall handling. Default `1800000`.

AIHub profiles are runner adapters, not Symphony roles. No label-to-profile routing exists.

### `hooks`

Hook commands run in the issue workspace.

- `after_create`: after new workspace directory is created.
- `before_run`: before worker starts. Non-zero exit aborts dispatch.
- `after_run`: after worker attempt completes or claim releases.
- `before_remove`: before workspace removal.

Manual run release only clears the orchestrator claim. Use interrupt or kill when the active worker should also stop; orchestrator-owned `Needs Human` parks stop the worker before the claim is released.

Hook env includes:

- `AIHUB_PROJECT_ID`
- `AIHUB_ISSUE_ID`
- `AIHUB_ISSUE_IDENTIFIER`
- `AIHUB_WORKSPACE`

`LINEAR_API_KEY` is intentionally not passed to hooks/workers.

### `linear`

- `exposeGraphqlTool`: enables `orchestrator.linear_graphql`. Default `true`.

Worker tool calls must include project id:

```json
{ "project": "aihub", "query": "...", "variables": {} }
```

The tool uses that project's workflow `tracker.api_key` and `tracker.endpoint`.

### Prompt body

Markdown body after frontmatter becomes worker prompt template.

Supported substitutions follow Symphony core inputs only:

- `{{issue.id}}`
- `{{issue.identifier}}`
- `{{issue.title}}`
- `{{issue.description}}`
- `{{issue.priority}}`
- `{{issue.branch_name}}`
- `{{issue.state}}`
- `{{issue.url}}`
- `{{issue.labels}}`
- `{{issue.blocked_by}}`
- `{{issue.created_at}}`
- `{{issue.updated_at}}`
- `{{attempt}}`

Rules:

- First run renders `attempt` as empty/null.
- Retries/continuations render `attempt` as the attempt number.
- Unknown variables fail workflow rendering.
- Unknown filters fail workflow rendering.
- Arrays/maps render as JSON.
- No `project`, `workspace`, `repo`, `run`, or secret variables are exposed to templates.

Repo bootstrap should prefer deterministic hooks/tooling. Prompt-driven cloning is allowed, but must stay inside the issue workspace.

## Runtime model

- Tracker scope comes from `WORKFLOW.md` `tracker.project_slug`.
- Linear auth comes from `tracker.api_key`, usually `$LINEAR_API_KEY`.
- Candidate issues are filtered by Linear project `slugId`.
- Workspace directories are per issue under `workspace.root`.
- Core orchestrator does not create git clones or worktrees.
- Gateway owns worker lifetime; workers stop with gateway.
- Restart recovery uses Linear state + preserved workspace directories. SQLite is observability/history.

Useful commands:

```bash
pnpm aihub:dev orchestrator projects
pnpm aihub:dev orchestrator workflow --project <project-id>
pnpm aihub:dev orchestrator tick --project <project-id>
pnpm aihub:dev orchestrator runs --project <project-id>
```
