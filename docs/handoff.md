# Hand-off

Date: 2026-04-09
Repo: `/Users/thinh/projects/.workspaces/PRO-220/_space`
Branch: `space/PRO-220`

## Current Effort: Harbor Evals for AIHub Migration

Porting legacy Python/LangChain CloudifAI workflows to full agent skills +
connectors in this repo, TDD-style, using Harbor as the eval harness.
Starting with the `sales_admin` workflow family.

**Plan**: `docs/plans/harbor-evals-for-aihub-migration.md`

### Status

All 5 wave-0 tasks scaffolded. Oracle + real-agent paths both green:

| Task                                 | Oracle | Real agent | Notes                     |
| ------------------------------------ | ------ | ---------- | ------------------------- |
| `sales-admin-renewals`               | 7/7 ✅  | 1.0 ✅     | pre-existing               |
| `sales-admin-quota-analysis`         | 8/8 ✅  | 1.0 ✅     | pre-existing               |
| `sales-admin-renewal-estimate-preview` | 8/8 ✅ | 1.0 ✅    | commit `bd4c86f`           |
| `sales-admin-arr-mrr-report`         | 9/9 ✅  | 1.0 ✅     | commit `bd4c86f`           |
| `sales-admin-tool-selection`         | 7/7 ✅  | 1.0 ✅     | commit `bd4c86f`           |

### Deviations from plan (all resolved)

#### 1. Oracle is not deterministic — FIXED

All 5 `solve.sh` scripts now write static JSON. No LLM calls in the oracle path.

#### 2. Missing `BaseInstalledAgent` wrapper — FIXED

`examples/harbor/agents/aihub_installed.py` implemented and validated across all 5 tasks.

#### 3. Verifiers overfitted to oracle exact values — FIXED (commit `bd4c86f`)

Original verifiers asserted exact field names (`type: "user_overage"`), exact tool-call
sequences, and exact `finalMessage` substrings. Real LLM output varies in formatting.

**Fix**: Verifiers now check semantic correctness:
- Correct numeric totals and per-company values (within tolerance)
- Required tools present (not exact sequence)
- Forbidden tools absent
- Artifact fallback: reads from file if agent wrote it, else parses JSON from `finalMessage`
- Instructions updated to explicitly require `write` tool for artifact files

### Architectural decisions (locked in)

- **AIHub as Installed Harbor agent** per plan Section 1:
  1. `aihub eval run` CLI — headless, single-turn, writes `result.json` + ATIF `trajectory.json`
  2. `aihub-eval-base` Docker image — multi-stage build, bakes CLI, vendored config, real connectors, uv/pytest, non-root `agent` user
  3. Solve script should be deterministic oracle; agent invocation via `BaseInstalledAgent` (not yet built)
- **Connector stubbing: Strategy B** — real connector code → fake HTTP sidecar via `adminApiBase`/`coreApiBase` override. Most faithful to production.
- **ATIF emitted natively** by `aihub eval run` (no converter phase).
- **Deterministic clock** via `EVAL_NOW=2026-04-06` in compose service env (NOT `[agent.env]` — harbor silently ignores it).
- **uv, not pip**, per AGENTS.md.
- **Verifiers check semantics, not exact strings** — real LLM output varies in field names, descriptions, tool arg formats. Assert numeric values, required tool presence, and forbidden tool absence.
- **Option C ownership split** (2026-04-10): aihub owns the eval engine (CLI, base image, smoke task); cloudihub owns product-specific tasks, fake sidecars, and agent config. The vendored `cloudihub-config/` and `sync-cloudihub-config.sh` have been removed.

### Key file locations (post Option C migration)

**aihub repo** (eval engine — vendor-neutral):
```
apps/gateway/src/evals/
├── cli.ts          # `aihub eval run` Commander wiring
├── runtime.ts      # runEval() — boot path + EventCollector
└── trajectory.ts   # ATIF-v1.4 emitter

examples/harbor/
├── agents/aihub_installed.py   # generic reference wrapper (no default agent)
├── base/aihub-eval/
│   ├── Dockerfile              # multi-stage CLI bake (no agent config)
│   └── aihub.json              # empty shell, overridden by consuming repos
└── tasks/smoke/                # vendor-neutral CLI contract test
```

**cloudihub repo** (product-specific tasks):
```
eval/
└── harbor/
    ├── agents/aihub_installed.py   # wrapper with DEFAULT_AIHUB_AGENT = "sally"
    ├── config/aihub.json           # eval-adapted sally config (fake sidecar URLs)
    ├── fakes/cloudifi-admin/       # FastAPI stub + fixtures
    └── tasks/sales-admin/          # 5 tasks + dataset.toml + metric.py
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
# 1. (one-time) build the eval base image from the aihub (platform/) repo root
cd platform
docker build -t aihub-eval-base:local -f examples/harbor/base/aihub-eval/Dockerfile .

# 2. run from cloudihub repo root (harbor/ dir)
cd ..
REQUESTY_API_KEY="$REQUESTY_API_KEY" harbor run --yes \
  -p eval/harbor/tasks/sales-admin/sales-admin-renewals \
  --agent-import-path eval.harbor.agents.aihub_installed:AIHubInstalledAgent \
  --env docker
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

### Sales-admin task coverage

Sales-admin Harbor dataset now lists all 5 wave-0 tasks:

- `sales-admin-renewals`
- `sales-admin-quota-analysis`
- `sales-admin-renewal-estimate-preview`
- `sales-admin-arr-mrr-report`
- `sales-admin-tool-selection`

New task notes:

- `sales-admin-renewal-estimate-preview`: task-local fixture override for ACME-42 pricing + overage preview; verifier checks correct amounts (299 + 105 = 404), company ID, total matches line items, forbids write tools on cloudifi_admin.
- `sales-admin-arr-mrr-report`: task-local pricing fixture override for all companies; verifier checks MRR/ARR totals, company IDs in descending MRR order, per-company values, ARR = MRR × 12 invariant.
- `sales-admin-tool-selection`: routing eval over ambiguous prompts; verifier checks required tools present in correct order (get_quota_usage before list_companies before get_company_details), allows extra calls (e.g. retries), forbids write tools.

### Next steps (prioritized)

1. **Token/cost metrics plumbing** — exit criteria #4. `result.json.metrics` and ATIF
   `final_metrics` are all 0. Need to extend `RunAgentResult.meta` → thread through
   `runtime.ts` → both `EvalResult` and `TrajectoryBuilder`.

2. **Runtime artifact tracking** — `EvalResult.artifacts` is hardcoded to `[]`.
   Should detect `write` tool calls that target `/app/out/*` and populate the field.
   Currently verifiers work around this via `finalMessage` JSON parsing fallback.

3. ~~**Option C migration**~~ — **Done** (2026-04-10). Tasks + fakes + agent config now live in cloudihub repo.

4. **Multi-trial reliability** — run each task with `--n-attempts 3` to confirm
   pass rate is consistently 1.0 (not a lucky single run).

### Commits on space/PRO-220 branch

```
bd4c86f fix(evals): make verifiers robust for real agent runs
c9c1c25 fix(evals): tighten sales-admin task checks
1cf6e04 feat(evals): add sales-admin harbor tasks
38cbe1d fix(evals): fix agent import path + add __init__.py
27a1c7a fix(evals): align installed agent metadata lookup and default agent id
446bb98 fix(evals): make harbor oracles deterministic
```

(+ earlier commits from the feature branch merged into this workspace)

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
