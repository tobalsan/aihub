# Hand-off

Date: 2026-04-08
Repo: `/Users/thinh/projects/.workspaces/aihub-harbor-evals-sales-admin`
Branch: `feature/harbor-evals-sales-admin` (worktree; base commit `1fb7bd7`)

## Current Effort: Harbor Evals for AIHub Migration

Porting legacy Python/LangChain CloudifAI workflows to full agent skills +
connectors in this repo, TDD-style, using Harbor as the eval harness.
Starting with the `sales_admin` workflow family.

**Plan**: `docs/plans/harbor-evals-for-aihub-migration.md`

### Status

Two tasks scaffolded, both green with deterministic `harbor run -a oracle`:

| Task | Status | Last job |
|---|---|---|
| `sales-admin-renewals` | ✅ pass_rate=1.0 | `jobs/2026-04-08__17-50-42/` |
| `sales-admin-quota-analysis` | ✅ pass_rate=1.0 | `jobs/2026-04-08__17-39-46/` |

Installed-agent path now validated via Harbor custom import path.

### Deviations from plan (must fix)

#### 1. Oracle is not deterministic

Per plan, `solution/solve.sh` should **write the expected output directly** (no LLM)
to prove the verifier is correct independently of the agent. Our `solve.sh` calls
`aihub eval run --agent sally`, which invokes a real LLM via requesty/Minimax-m2.7.

This means we never validated the verifier in isolation. The oracle and agent
paths are identical — if the verifier has a bug, both pass or both fail together.

**Status**: fixed in this workspace for `sales-admin-renewals` and
`sales-admin-quota-analysis`.

**Fix**: rewrite `solve.sh` for each task to produce the expected artifact
(e.g., `/app/out/renewals.json`, `/app/out/quota_analysis.json`) plus a minimal
`/logs/agent/result.json` with hardcoded tool calls and final message. No `aihub eval run`.

#### 2. Missing `BaseInstalledAgent` wrapper

Per plan Task 2, `examples/harbor/agents/aihub_installed.py` should be a
`BaseInstalledAgent` subclass that calls `aihub eval run` via `exec_as_agent`.
This lets Harbor invoke the real agent with:

```bash
harbor run -p tasks/sales-admin/sales-admin-renewals -a aihub-installed
```

We never built this. Currently the only way to run the real agent is through
the oracle path, which conflates oracle and agent runs.

**Status**: fixed and validated in this workspace.

**Fix**: `examples/harbor/agents/aihub_installed.py` now reads
`AgentContext.metadata`, defaults to `sally`, and task metadata also points to
`sally`, matching `examples/harbor/base/aihub-eval/aihub.json`.

### Architectural decisions (locked in)

- **AIHub as Installed Harbor agent** per plan Section 1:
  1. `aihub eval run` CLI — headless, single-turn, writes `result.json` + ATIF `trajectory.json`
  2. `aihub-eval-base` Docker image — multi-stage build, bakes CLI, vendored config, real connectors, uv/pytest, non-root `agent` user
  3. Solve script should be deterministic oracle; agent invocation via `BaseInstalledAgent` (not yet built)
- **Connector stubbing: Strategy B** — real connector code → fake HTTP sidecar via `adminApiBase`/`coreApiBase` override. Most faithful to production.
- **ATIF emitted natively** by `aihub eval run` (no converter phase).
- **Deterministic clock** via `EVAL_NOW=2026-04-06` in compose service env (NOT `[agent.env]` — harbor silently ignores it).
- **uv, not pip**, per AGENTS.md.
- **Option A vendor bridge** for sally config. Snapshot from cloudihub repo into `examples/harbor/base/aihub-eval/cloudihub-config/`. Will be retired by Option C migration.

### Key file locations

```
apps/gateway/src/evals/
├── cli.ts          # `aihub eval run` Commander wiring
├── runtime.ts      # runEval() — boot path + EventCollector
└── trajectory.ts   # ATIF-v1.4 emitter

examples/harbor/
├── agents/                          # (MISSING — needs aihub_installed.py)
├── base/
│   ├── aihub-eval/
│   │   ├── Dockerfile                # multi-stage CLI bake
│   │   ├── aihub.json                # eval-adapted sally config
│   │   └── cloudihub-config/         # vendored from cloudihub repo
│   │       ├── models.json           # requesty custom provider
│   │       ├── agents/sally/         # SOUL/IDENTITY/USER/AGENTS/.pi/SYSTEM.md + skills
│   │       └── connectors/cloudifi-admin/  # compiled JS from aihub-connectors
│   └── fakes/cloudifi-admin/
│       ├── Dockerfile
│       ├── server.py                 # FastAPI stub (auth + companies + quota endpoints)
│       └── fixtures/{companies,quota_report}.json
└── tasks/sales-admin/
    ├── sales-admin-renewals/
    │   ├── task.toml
    │   ├── instruction.md
    │   ├── solution/{solve.sh, instruction.md}
    │   ├── environment/{Dockerfile, docker-compose.yaml}
    │   └── tests/{test.sh, test_outputs.py}
    └── sales-admin-quota-analysis/   # same structure
```

### Network architecture

`allow_internet=true` in task.toml (required — harbor's `allow_internet=false` injects
`network_mode: none` which is mutually exclusive with compose networks). Two networks:

- `sandbox` — `internal: true`, both `main` and `fake-cloudifi-admin`. No host/internet egress.
- `egress` — default bridge, `main` only. Lets LLM API call reach `router.requesty.ai`.

### Env var flow

- **REQUESTY_API_KEY**: `task.toml [environment.env]` → compose `${REQUESTY_API_KEY:?...}`
- **EVAL_NOW**: hardcoded `"2026-04-06"` in compose `services.main.environment` (not `[agent.env]`)

### Gotchas (root-caused, fixed)

1. **`[agent.env]` silently ignored** — Harbor's `TaskConfig.agent` Pydantic model has no `env` field. Use compose service env instead.
2. **Stale `tsconfig.tsbuildinfo`** — added `**/*.tsbuildinfo` to `.dockerignore`.
3. **`auth.mode: "api_key"`** branch has no `requesty` entry — removed `auth` field; default branch reads from `models.json`.
4. **`components: {discord: {enabled: false}}`** still zod-validates `discord.token`. Use `components: {}`.
5. **Connector module resolution** — `cloudifi-admin/index.js` imports `zod`. Symlink `/opt/aihub/node_modules` → `/eval/node_modules`.
6. **`solution/instruction.md` symlink** doesn't survive `docker compose cp`. Use real file copy.
7. **Agent id mismatch** — fixed. Installed-agent wrapper default + task metadata now use `sally`, matching the vendored eval config.

### How to reproduce a green run

```bash
# 1. (one-time) build the eval base image
docker build -t aihub-eval-base:local -f examples/harbor/base/aihub-eval/Dockerfile .

# 2. oracle path
cd examples/harbor
yes | REQUESTY_API_KEY="$REQUESTY_API_KEY" harbor run -p tasks/sales-admin/sales-admin-quota-analysis -a oracle

# 3. installed-agent path
REQUESTY_API_KEY="$REQUESTY_API_KEY" harbor run --yes \
  -p tasks/sales-admin/sales-admin-renewals \
  --agent-import-path agents.aihub_installed:AIHubInstalledAgent \
  --env docker
```

Expected: `Mean: 1.000`, `pass_rate = 1.0` for both.

### What Sally does in a green quota-analysis run

1. Reads her config/skills from `/eval/agents/sally/`
2. Calls `cloudifi_admin.list_companies` → gets `maxUsers` per company
3. Calls `cloudifi_admin.get_quota_usage("2026-04-01", "2026-04-06")` → gets `maxGuest` per company
4. Filters: `maxGuest >= floor(maxUsers * 0.8)` → 3 at-risk companies
5. Writes `/app/out/quota_analysis.json` sorted by `usagePercent` descending
6. Returns `"Found 3 companies at or above 80% user quota."`

Expected rows: 1002 Globex (93%), 1001 Acme (82%), 1004 Umbrella (82%).

### Next steps (prioritized)

1. **Scaffold remaining 3 sales-admin tasks**:
   - `sales-admin-renewal-estimate-preview`
   - `sales-admin-arr-mrr-report`
   - `sales-admin-tool-selection`
     Pattern: copy quota-analysis as template, swap instruction/fixtures/verifier.

2. **Token/cost metrics plumbing** — exit criteria #4. `result.json.metrics` and ATIF
   `final_metrics` are all 0. Need to extend `RunAgentResult.meta` → thread through
   `runtime.ts` → both `EvalResult` and `TrajectoryBuilder`.

3. **Option C migration** — after all 5 tasks green + metrics plumbed + CLI stable for 2 weeks.
   See plan "Option C" section. Moves tasks + agent config ownership to cloudihub repo.

### Commits on feature branch

```
c60e69b chore: ignore harbor eval job artifacts
a22909b docs(plans): harbor evals plan for strategy B
41d5185 feat(evals): scaffold harbor sales-admin-renewals task
ed43c11 fix(evals): use internal network for sidecar reachability
479d151 feat(evals): aihub eval run headless CLI
2b74f8d docs(handoff): harbor evals C+B progress
d6efb52 docs(handoff): record live LLM smoke results
85eb2f7 feat(evals): vendor sally cloudihub config
23a5d7a feat(evals): add egress net + requesty key passthrough
e0b25ba docs(plans): option C migration to cloudihub
a9b4e2a feat(evals): bake aihub CLI into eval base image
a63adf1 feat(evals): vendor cloudifi-admin connector
5e3dc4e feat(evals): solve.sh runs real aihub eval run
e182631 fix(evals): propagate EVAL_NOW via compose env
```

Uncommitted: `sales-admin-quota-analysis` task scaffolding + `a13ac1e` skill tightening.

## Repository context (for new sessions)

- `docs/llms.md` — full project architecture, config schema, API endpoints
- `docs/plans/harbor-evals-for-aihub-migration.md` — complete eval migration plan (Option A spike + Option C long-term)
- `pnpm test -- <path>` — run tests serially to avoid transient ENOENT flake

## PRO-219: Sidebar real-time refresh

- `subscribeToStatus()` now uses a shared reconnecting status socket, matching the existing file-change websocket pattern; `AgentDirectory` refetches lead-agent statuses after reconnect.
- Gateway/web websocket debug logging is available behind `DEBUG=aihub:ws` and browser `localStorage.debug=aihub:ws`.
- `GET /api/debug/events` exposes the recent in-memory event buffer for sidebar debugging.
- `scripts/verify-sidebar.sh` now exercises the actual `ACTIVE PROJECTS` path end-to-end: it creates/removes a temp `PRO-*` session directory while the page is open, verifies the sidebar add/remove behavior, and confirms `/api/debug/events` recorded `agentChanged`.
- `apps/gateway/src/projects/watcher.ts` now watches the projects root (bounded depth) for session changes; the previous `*/sessions` chokidar target missed nested `sessions/<slug>/state.json` updates on disk.
- Gateway regression coverage now includes status websocket reconnect delivery and `agent_changed` emission/debounce for `sessions/*/state.json`.
- Follow-up UI fix on `main`: the right `ContextPanel` stays visible on `/projects/:id`, and the recent-project list moved from the left nav to the bottom of that sidebar.
- Follow-up UI fix on `main`: project-detail `AgentChat` now virtualizes only longer histories (`>=80` rows), remeasures visible rows on pane resize, and re-anchors the last row when already at bottom so tail lines do not vanish behind stale virtual padding after refresh/layout shifts.
- Follow-up UX fix on `main`: project-detail UI spawns now derive subagent session-folder slugs from the displayed run name instead of a random harness timestamp slug.
- Follow-up CLI fix on `main`: `apm status <projectId> --list` prints the existing project subagent session slugs (or a JSON array with `--json`) so users no longer need to inspect the `sessions/` directory manually.
- Remaining blocker: `/api/debug/events` auth is not authorization-scoped in multi-user mode.
