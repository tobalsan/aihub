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
| `sales-admin-renewals` | ✅ pass_rate=1.0 | `jobs/2026-04-08__17-39-03/` |
| `sales-admin-quota-analysis` | ✅ pass_rate=1.0 | `jobs/2026-04-08__17-39-46/` |

**Remaining gap**: the installed-agent path still needs validation via
`harbor run -a aihub-installed` (see below).

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

**Fix**: create `examples/harbor/agents/aihub_installed.py` (~40 lines per plan).

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
7. **Agent id mismatch** — verifier expected `sales-admin`, vendored agent is `sally`.

### How to reproduce a green run

```bash
# 1. (one-time) build the eval base image
docker build -t aihub-eval-base:local -f examples/harbor/base/aihub-eval/Dockerfile .

# 2. run. REQUESTY_API_KEY must be in the shell.
cd examples/harbor
yes | REQUESTY_API_KEY="$REQUESTY_API_KEY" harbor run -p tasks/sales-admin/sales-admin-quota-analysis -a oracle
```

Expected: `Mean: 1.000`, `pass_rate = 1.0`.

### What Sally does in a green quota-analysis run

1. Reads her config/skills from `/eval/agents/sally/`
2. Calls `cloudifi_admin.list_companies` → gets `maxUsers` per company
3. Calls `cloudifi_admin.get_quota_usage("2026-04-01", "2026-04-06")` → gets `maxGuest` per company
4. Filters: `maxGuest >= floor(maxUsers * 0.8)` → 3 at-risk companies
5. Writes `/app/out/quota_analysis.json` sorted by `usagePercent` descending
6. Returns `"Found 3 companies at or above 80% user quota."`

Expected rows: 1002 Globex (93%), 1001 Acme (82%), 1004 Umbrella (82%).

### Next steps (prioritized)

1. **Validate installed-agent path** — run with `-a aihub-installed`
   to confirm the full stack works through Harbor's agent interface.

2. **Create `BaseInstalledAgent` wrapper** — `examples/harbor/agents/aihub_installed.py`.
   ~40 lines per plan Task 2. Enables `harbor run -a aihub-installed` for real agent evals.
   This is exit criteria #3: "at least one task passes end-to-end with the real `aihub eval run`."

3. **Confirm wrapper state vs docs** — repo currently contains
   `examples/harbor/agents/aihub_installed.py`; reconcile docs/plan tracking
   and validate it matches the intended pattern before closing the task.

4. **Scaffold remaining 3 sales-admin tasks**:
   - `sales-admin-renewal-estimate-preview`
   - `sales-admin-arr-mrr-report`
   - `sales-admin-tool-selection`
   Pattern: copy quota-analysis as template, swap instruction/fixtures/verifier.

5. **Token/cost metrics plumbing** — exit criteria #4. `result.json.metrics` and ATIF
   `final_metrics` are all 0. Need to extend `RunAgentResult.meta` → thread through
   `runtime.ts` → both `EvalResult` and `TrajectoryBuilder`.

6. **Option C migration** — after all 5 tasks green + metrics plumbed + CLI stable for 2 weeks.
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
