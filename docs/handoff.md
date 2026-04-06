# Hand-off

Date: 2026-04-06
Repo: `/Users/thinh/projects/.workspaces/aihub-harbor-evals-sales-admin`
Branch: `feature/harbor-evals-sales-admin` (worktree; base commit `1fb7bd7`)

## Current Effort: Harbor Evals for AIHub Migration

We are porting legacy Python/LangChain CloudifAI workflows
(`~/agents/cloud/cloudifai-workflows-to-port.md`) to full agent skills +
connectors in this repo, TDD-style, using the Harbor framework as the
eval harness. Starting with the `sales_admin` workflow family.

**Plan**: `docs/plans/harbor-evals-for-aihub-migration.md` (8 impl tasks
+ 5 sales_admin eval tasks; Option C migration section appended at
lines 620-1409).

### Status: real `aihub eval run` end-to-end green ✅

```bash
cd examples/harbor && yes | REQUESTY_API_KEY="$REQUESTY_API_KEY" \
  harbor run -p tasks/sales-admin/sales-admin-renewals -a oracle
```

→ `pass_rate = 1.0`, ~52s, 7/7 verifier pytest assertions pass.

This exercises the **full** stack: real `aihub eval run` CLI → real
Sally agent (vendored prod workspace) → real `requesty` custom provider
(Minimax-m2.7) → real `cloudifi-admin` connector → fake HTTP sidecar →
real verifier. No oracle JSON anymore.

Latest known-good job: `examples/harbor/jobs/2026-04-06__20-59-16/`.

### Architectural decisions (locked in)

- **AIHub as Installed Harbor agent**, three layers:
  1. `aihub eval run` CLI — headless, single-turn, writes `result.json`
     + ATIF `trajectory.json`. Skips HTTP server / Discord / amsg /
     scheduler / heartbeat / multi-user / web UI by passing an empty
     component list to `prepareStartupConfig`.
  2. `aihub-eval-base` Docker image — multi-stage build from repo root;
     bakes CLI via `pnpm deploy --prod`, vendored Sally workspace, real
     compiled connectors, uv-managed pytest, non-root `agent` user.
  3. Solve script (`solution/solve.sh`) calls the CLI directly; no
     Python wrapper agent needed for harbor's oracle path.
- **Connector stubbing: Strategy B** (real connector code → fake HTTP
  sidecar via `adminApiBase`/`coreApiBase` config override). Most
  faithful to production. `cloudifi_admin` already supported it natively.
- **ATIF emitted natively** by `aihub eval run` (no converter phase).
- **Deterministic clock** via `EVAL_NOW=2026-04-06`. Injected via
  compose service env (NOT `[agent.env]`, which harbor silently ignores
  — see EVAL_NOW gotcha below).
- **uv, not pip**, per AGENTS.md. Installed in `aihub-eval-base` via
  `COPY --from=ghcr.io/astral-sh/uv:latest`, `uv tool install pytest`,
  `UV_TOOL_DIR=/opt/uv/tools` so `agent` user finds it offline.
- **Option A vendor bridge** for sally config. Snapshot from sibling
  `cloudihub` repo into `examples/harbor/base/aihub-eval/cloudihub-config/`.
  Sync via `scripts/sync-cloudihub-config.sh`. Will be retired by
  **Option C** migration once all 5 tasks are green (see plan doc).

### Key file locations

```
apps/gateway/src/evals/
├── cli.ts          # `aihub eval run` Commander wiring
├── runtime.ts      # runEval() — boot path + EventCollector
└── trajectory.ts   # ATIF-v1.4 emitter

apps/gateway/src/cli/index.ts            # registers eval commands

examples/harbor/base/aihub-eval/
├── Dockerfile                            # multi-stage CLI bake
├── aihub.json                            # eval-adapted sally config
├── README.md
└── cloudihub-config/                     # vendored from cloudihub repo
    ├── models.json                       # requesty custom provider
    ├── agents/sally/                     # SOUL/IDENTITY/USER/AGENTS/.pi/SYSTEM.md
    │   └── skills/renewal-check/         # plus skill-creator (unused here)
    └── connectors/cloudifi-admin/        # compiled JS from aihub-connectors repo

examples/harbor/base/fakes/cloudifi-admin/
├── Dockerfile
├── server.py                             # FastAPI stub
└── fixtures/companies.json               # 8 companies, 3 in 30-day window

examples/harbor/tasks/sales-admin/sales-admin-renewals/
├── task.toml                             # allow_internet=true, REQUESTY_API_KEY passthrough
├── instruction.md                        # task spec given to the agent
├── solution/
│   ├── solve.sh                          # calls `aihub eval run -a sally`
│   └── instruction.md                    # COPY of ../instruction.md (not symlink)
├── environment/
│   ├── Dockerfile                        # FROM aihub-eval-base:local
│   └── docker-compose.yaml               # sandbox + egress networks, env passthrough
└── tests/
    ├── test_outputs.py                   # 7 pytest assertions
    └── test.sh                           # writes /logs/verifier/reward.json

scripts/sync-cloudihub-config.sh          # rsync from $CLOUDIHUB_CONFIG_DIR
.dockerignore                              # excludes node_modules, dist, *.tsbuildinfo
```

### Network architecture

Harbor injects `network_mode: none` on `main` whenever
`allow_internet=false`, which is mutually exclusive with attaching to
any compose network. So we use:

- `allow_internet=true` in task.toml (with explanatory comment block)
- Two networks in `environment/docker-compose.yaml`:
  - `sandbox` — `internal: true`, attached to both `main` and
    `fake-cloudifi-admin`. Service-DNS works, no host/internet egress.
  - `egress` — default bridge, attached only to `main`. Lets the LLM
    API call (`router.requesty.ai`) reach the host network.
- `fake-cloudifi-admin` is on `sandbox` only — sidecar can't exfiltrate.

### Env var flow (REQUESTY_API_KEY + EVAL_NOW)

- **REQUESTY_API_KEY**: declared in `task.toml [environment.env]`
  (harbor's host-env passthrough whitelist). Resolved via
  `${REQUESTY_API_KEY:?...}` in compose service env. Fails fast if the
  shell running harbor doesn't have it set.
- **EVAL_NOW**: hardcoded `"2026-04-06"` directly in compose service
  env (not host-derived). NOT in `[agent.env]` — see gotcha below.

### EVAL_NOW gotcha (root-caused, fixed)

Harbor's `TaskConfig.agent` Pydantic model
(`harbor/models/task/config.py:77-83`) has **no `env` field**.
`[agent.env]` in task.toml is **silently ignored** at parse time. Only
`[verifier.env]` is honored — that's why the verifier's
`test_eval_now_is_fixed` passed even when the agent saw `EVAL_NOW=not set`.

Fix applied: declare `EVAL_NOW` in `services.main.environment` of
`environment/docker-compose.yaml`. Compose service env propagates
naturally to all subprocesses (`solve.sh` → `aihub eval run` → Node →
pi-coding-agent bash tool).

Verified post-fix: Sally's `bash` tool now sees `EVAL_NOW=2026-04-06`
in `examples/harbor/jobs/2026-04-06__20-59-16/` agent result.

Not a pi/bash-tool sanitization bug — pi `bash` tool already passes
`process.env` through cleanly
(`pi-coding-agent/dist/core/tools/bash.js:42-47`).

### Other gotchas hit & fixed

1. **Stale `tsconfig.tsbuildinfo`** in docker context made tsc skip
   `.d.ts` emission for "unchanged" files → added `**/*.tsbuildinfo`
   to `.dockerignore`.
2. **`auth.mode: "api_key"`** branch in pi SDK adapter
   (`apps/gateway/src/sdk/pi/adapter.ts:215`) only checks pi-ai's
   builtin env map, which has no `requesty` entry. Removed `auth`
   field entirely; default branch reads custom provider config from
   `models.json`.
3. **`components: {discord: {enabled: false}}`** still zod-validates
   `discord.token` as required. Use `components: {}` (matches prod).
4. **Connector module resolution**: `cloudifi-admin/index.js` does
   `import { z } from "zod"`. Node walks up from `/eval/connectors/...`
   looking for `node_modules/zod`. We `ln -s /opt/aihub/node_modules
   /eval/node_modules` so connectors resolve against the gateway's
   flat deps tree.
5. **`solution/instruction.md` symlink** to `../instruction.md` does
   NOT survive `docker compose cp` (symlinks copied as-is, target
   doesn't exist in container). Use a real file copy. Duplication
   noted as a follow-up.
6. **Agent id mismatch**: original verifier expected
   `result["agent"] == "sales-admin"`. Vendored agent is `sally`. Test
   updated. (Sally IS the sales-admin agent; the task name vs agent
   id distinction is intentional.)

### Commits on feature branch (oldest → newest)

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

Base commit on `main`: `1fb7bd7`.

### How to reproduce a green run

```bash
cd /Users/thinh/projects/.workspaces/aihub-harbor-evals-sales-admin

# 1. (one-time) build the eval base image
docker build -t aihub-eval-base:local \
  -f examples/harbor/base/aihub-eval/Dockerfile .

# 2. (one-time per cloudihub change) sync the vendored sally config
bash scripts/sync-cloudihub-config.sh

# 3. run the task. REQUESTY_API_KEY must be in the shell.
export REQUESTY_API_KEY=...   # from secrets manager
cd examples/harbor
yes | harbor run -p tasks/sales-admin/sales-admin-renewals -a oracle
```

Expected: `Mean: 1.000`, `pass_rate = 1.0`, ~52s.

### What Sally actually does in a green run

From `jobs/2026-04-06__20-59-16/sales-admin-renewals__*/agent/result.json`:

1. Reads her own `renewal-check` skill from
   `/eval/agents/sally/skills/renewal-check/SKILL.md`
2. Verifies `EVAL_NOW=2026-04-06` via bash
3. Calls `cloudifi_admin.list_companies(extraFields: true)` against
   `http://fake-cloudifi-admin:8080`
4. Filters to billingDate within +30 days of EVAL_NOW
5. Writes `/app/out/renewals.json` (sorted ascending by daysUntilRenewal)
6. Returns `"Found 3 companies with renewals in the next 30 days."`

Note: in the previous run (`__20-52-47`, before EVAL_NOW fix), Sally
initially wrote 4 companies including Umbrella Retail (+34 days) before
self-correcting. Skill copy ambiguity — see follow-up #5.

### Follow-ups (prioritized)

1. **Tighten Sally's `renewal-check` skill** for eval determinism. The
   "30 days" window is ambiguous (`<= today + 30` vs `< today + 31`
   vs `<= today + 30 inclusive of both ends`). Sally currently figures
   it out via reasoning + self-correction, which costs latency and is
   non-deterministic. Edit
   `examples/harbor/base/aihub-eval/cloudihub-config/agents/sally/skills/renewal-check/SKILL.md`
   to spell out the inclusive/exclusive boundary and preferred
   computation. Then sync upstream to cloudihub (the vendor direction
   reverses for prompt fixes during Option A — remember to copy
   changes back to `~/code/algodyn/cloudihub/config/agents/sally/`).
2. **Token/cost metrics plumbing**. `result.json.metrics.{inputTokens,
   outputTokens, costUsd}` and ATIF `final_metrics.{input_tokens,
   output_tokens, cost_usd}` are all 0. Pi adapter's `RunAgentResult`
   doesn't surface usage. Need to extend the SDK adapter contract
   (`apps/gateway/src/sdk/types.ts` `RunAgentResult.meta`) to include
   token counts + cost, then thread them through `runtime.ts` → both
   `EvalResult` and `TrajectoryBuilder`.
3. **Scaffold remaining 4 sales-admin tasks**:
   - `sales-admin-quota-analysis` — uses `cloudifi_admin.get_quota_usage`
   - `sales-admin-renewal-estimates` — TBD
   - `sales-admin-arr-report` — TBD
   - 5th task TBD
   Pattern: copy `sales-admin-renewals/` as a template, swap
   `instruction.md`, `tests/test_outputs.py`, expected fixture rows,
   keep compose/Dockerfile/task.toml structure identical. The fake
   sidecar already implements quota endpoints — see
   `examples/harbor/base/fakes/cloudifi-admin/server.py`.
4. **`solution/instruction.md` duplication cleanup**. Currently a
   verbatim copy of `instruction.md` at the task root because
   symlinks don't survive `docker compose cp`. Options:
   (a) pre-build hook copies one to the other; (b) CI check that they
   match; (c) only keep the one in `solution/` and have harbor read
   it from there (would require harbor task schema understanding).
   Defer to Option C migration.
5. **Option C migration trigger**. Exit criteria spelled out in plan
   doc lines ~640-680. The two big remaining gates: (a) all 5 tasks
   green with real CLI, (b) token/cost metrics plumbed. Once those
   land, execute the 7-step migration sequence (plan doc lines
   ~1000-1100).
6. **CI wiring** for harbor evals. Deferred to Option C — runs in
   cloudihub CI, not aihub CI. aihub CI gets a minimal smoke task
   under `examples/harbor/tasks/smoke/` that just exercises the CLI.
7. **Upstream Sally's skill fix** to `~/code/algodyn/cloudihub/config/agents/sally/skills/renewal-check/SKILL.md`
   after follow-up #1 lands. Until Option C migration completes, the
   sync direction during Option A is **cloudihub → aihub vendor**.
   Prompt fixes made in the vendor must be hand-copied back. The sync
   script overwrites in the cloudihub→vendor direction.
8. **(Optional) `aihub-connectors` snapshot freshness check**. We
   vendored compiled JS from `~/code/aihub-connectors/dist/cloudifi-admin/`.
   Sync script does NOT cover that source — it pulls from
   `~/code/algodyn/cloudihub/config/connectors/cloudifi-admin/` which
   is itself a symlink to the aihub-connectors dist. The chain works
   because the sync script resolves the symlink target, but it's
   worth noting that connector bug fixes upstream require rebuilding
   `aihub-connectors` AND re-running the sync script.

### Continuation prompt for next session

Start by reading:
1. This handoff section (you're in it)
2. `docs/plans/harbor-evals-for-aihub-migration.md` (especially the
   Option C migration section appended at lines 620-1409)
3. `examples/harbor/jobs/2026-04-06__20-59-16/sales-admin-renewals__*/agent/result.json`
   to see what a successful Sally run looks like

Then pick a follow-up from the list above. Default suggested order:
#1 (skill tightening, fast win) → #3 (scaffold next task) → #2 (token
metrics) → #4-#7 cleanup → #5 Option C migration.

## Current Status

- 2026-04-06 harbor evals milestone: real `aihub eval run` end-to-end green via `harbor run -p tasks/sales-admin/sales-admin-renewals -a oracle`; Sally agent loaded from vendored `examples/harbor/base/aihub-eval/cloudihub-config/agents/sally/`; custom `requesty` provider resolved from vendored `models.json`; real `cloudifi-admin` connector (vendored from `aihub-connectors`) calling fake sidecar at `http://fake-cloudifi-admin:8080`; live LLM via Minimax-m2.7 over requesty; 7/7 verifier pytest assertions pass; pass_rate=1.0; ~52s; latest job dir: `examples/harbor/jobs/2026-04-06__20-52-47/`
- 2026-04-06 harbor evals spike B landed: `aihub eval run` CLI in `apps/gateway/src/evals/{cli,runtime,trajectory}.ts`. Headless single-turn entrypoint reusing the same boot path as `aihub send` (loadConfig → connectors → runAgent) with an empty component list, aggregating `StreamEvent`s into `result.json` + ATIF `trajectory.json`. Smoke-tested end-to-end against a throwaway config.
- 2026-04-06 harbor evals network fix: `sales-admin-renewals` switched to `allow_internet=true` + `internal: true` `sandbox` compose network so `main` can reach the `fake-cloudifi-admin` sidecar. Harbor's `network_mode: none` injection on `allow_internet=false` is mutually exclusive with attaching to compose networks. Oracle still green.
- 2026-04-06 web markdown dedupe follow-up landed: `AgentChat`, `TaskboardOverlay`, `ConversationThreadView` use shared `apps/web/src/lib/markdown.ts`; `SpecEditor` uses it with `breaks: false`; `ProjectsBoard` keeps its wrapper (project-specific rewrites).
- 2026-04-06 test-suite speedup landed: subagent API test seeds one reusable git repo in `beforeAll()` and copies per test; vitest `maxWorkers: 4`. Full `pnpm test` now `57.86s` (95/95 files, 728/728) vs `133.51s` before.
- 2026-04-05 PRO-214 mobile scroll fix landed: `overscroll-behavior: contain`, `touch-action: pan-y`, `-webkit-overflow-scrolling: touch`, `100dvh` mobile sidebar, `flex-shrink: 0` chat input across agents/chat/activity/areas/conversations.
- 2026-04-05 PRO-212 Discord bot dedupe landed: shared `createConfiguredDiscordBot()` factory for legacy + component-routed bots.
- 2026-04-05 PRO-212 code-quality slice landed: shared helpers for Discord flow, session-file resolution, frontmatter, web markdown/history/timestamp, ws dispatch; OpenClaw adapter aligned; session + Claude stores lazy-load via `fs.promises`.
- 2026-04-05 PRO-212 dead-code slice landed: removed `queueOrRun`, deprecated `HistoryMessage` aliases, redundant `getConfig()` / web `fetchHistory()` wrappers, unused `gatewayConfig` arg, Claude `sentTurnEnd` guard.
- 2026-04-05 PRO-212 DRY slice landed: shared `expandPath()`, network bind helpers in `packages/shared/src/network.ts`, shared `getProjectsRoot()`/`dirExists()`/`findProjectDir()`/`isMultiUserLoaded()`; web `api/types.ts` reuses shared types.
- 2026-04-05 session-store save race fix: each save now uses a unique temp file instead of reusing one `.<pid>.tmp` path.
- 2026-04-04 PRO-209 multi-user auth landed: Better Auth + SQLite behind top-level `multiUser`, `/api/auth/*`, `/api/me`, `/api/admin/*`, per-user session/history isolation, web login/admin pages, integration coverage.
- 2026-04-04 PRO-208 cleanup landed: legacy `secrets.provider="onecli"` / `$secret:` vault lookup path removed. Only native top-level `onecli` proxy wiring + `$env:` refs remain.
- 2026-04-04 PRO-208 connector slice landed: `apps/gateway/src/connectors/http-client.ts` OneCLI-aware fetch wrapper with scoped proxy/CA env, default headers/timeouts.
- 2026-04-04 PRO-211 landed: `apm create --area <area>` with validation.
- 2026-04-03 PRO-208 Phase 1 landed: native top-level `onecli` schema + scoped env builder.
- 2026-04-03 follow-ups: `aihub send` initializes connectors; connector discovery follows symlinks and defaults to `$AIHUB_HOME/connectors`; Pi adapter only mounts subagent tools when `projects` loaded; ChatView no longer reloads history on every `isStreaming` transition; all agent run failures now logged from shared runner catch.
- 2026-04-03 PRO-206 scope 1 landed: optional connector-level `systemPrompt` propagated into Pi/Claude system prompts via `getConnectorPromptsForAgent()`.
- 2026-04-03 PRO-199 review fixes + runtime integration + shared foundation landed: connector contracts, registry, loader, external discovery, Pi/Claude tool injection, startup validation.
- 2026-04-02 PRO-198 Phase 5 hardening: component `routePrefixes` metadata, resolved-config threading, static registry for server-side route guards.
- 2026-04-02 PRO-198 `apm config migrate`/`validate` CLI; migration tightened to not auto-add `components.amsg`/`components.conversations` unless legacy implied.
- 2026-04-02 PRO-198 Phase 3+4: `api.core.ts` rename, disabled-component `/api/*` guards, web capabilities store gates sidebar/routes.
- 2026-04-02 PRO-198 Phase 2a: real component wrappers for scheduler/heartbeat/amsg/conversations owning their routes.
- 2026-04-02 PRO-198 Phase 1: component contracts, v2 config schemas, `$env:`/`$secret:` resolution, `GET /api/capabilities`.
- 2026-04-02 main repo: `AgentDirectory` uses ws feed (no 5s polling).
- 2026-03-30 PRO-164 mobile responsive project detail UI landed: `<1199px` compact, `<768px` mobile tabs, touch target sizing, tablet 280px left rail.
- PRO-198 modular architecture is integrated on `space/PRO-198`.
- Local preview entrypoints honor `AIHUB_HOME`; legacy `AIHUB_CONFIG` still falls back.
- Main server `/api` mounting delegates to the live component-mutated router.

## Recent Updates (Detailed — within ~2 weeks)

### 2026-04-06: test-suite speedup

- `apps/gateway/src/subagents/subagents.api.test.ts`, `vitest.config.ts`
  - Seeded `repoTemplateDir` in `beforeAll()` and switched to `createRepoCopy()` so the suite reuses a pre-committed git fixture.
  - Re-enabled file-level parallelism with `maxWorkers: 4`.
  - `pnpm test`: 133.51s → 57.86s. No assertions removed.

### 2026-04-06: web markdown dedupe follow-up

- `AgentChat`, `TaskboardOverlay`, `ConversationThreadView` → shared `apps/web/src/lib/markdown.ts` directly.
- `SpecEditor` uses it with `breaks: false` to preserve rendering.
- `ProjectsBoard` keeps its thin wrapper (project-specific rewrite/strip).

### 2026-04-05: PRO-214 mobile web scroll isolation

- `apps/web/src/App.tsx`, `apps/web/src/components/{AgentSidebar,AgentList,ChatView,ActivityFeed,AreasOverview}.tsx`, `apps/web/src/components/conversations/ConversationsPage.tsx`
  - `overscroll-behavior: contain`, `touch-action: pan-y`, `-webkit-overflow-scrolling: touch`.
  - Mobile sidebar `100%` + `100dvh`.
  - Chat input `flex-shrink: 0`.

### 2026-04-05: PRO-212 Discord bot dedupe

- `apps/gateway/src/discord/bot.ts`: `createDiscordBot()` and `createDiscordComponentBot()` share `createConfiguredDiscordBot()`.
- `bot.test.ts`: component-bot coverage for routed + DM handling.

### 2026-04-05: PRO-212 code-quality slice

- Shared helpers: Discord flow, session file resolution, frontmatter, web markdown/history/timestamp formatting, ws event dispatch.
- OpenClaw matches object-literal adapter pattern; session + Claude stores lazy-load via `fs.promises`.

### 2026-04-05: PRO-212 dead-code cleanup slice

- Removed `queueOrRun()`, deprecated runner `HistoryMessage` alias, `config.getConfig()` / web `fetchHistory()` wrappers, unused `gatewayConfig` arg from `getConnectorPromptsForAgent()`, redundant Claude `sentTurnEnd` guard.

### 2026-04-05: PRO-212 DRY cleanup slice

- Shared `expandPath()`, `pickTailnetIPv4()`, `getTailscaleIP()`, `resolveBindHost()` in `@aihub/shared`.
- Shared gateway `getProjectsRoot()` + `dirExists()`.
- Web `api/types.ts` reuses shared history/stream/taskboard/subagent types.
- Registry mocks updated in `admin-routes.test.ts` + `status-ws.test.ts` for new `isMultiUserLoaded()` export.

### 2026-04-05: Session-store save race fix

- `apps/gateway/src/sessions/{store,claude}.ts`: each save uses a unique temp file. Added concurrent-save coverage.

### 2026-04-04: PRO-209 multi-user auth integration + docs

- `apps/gateway/src/components/multi-user/*`, `apps/web/src/auth/*`, `apps/web/src/pages/admin/*`.
- Better Auth + SQLite behind top-level `multiUser`; API/WebSocket auth guards; admin assignment APIs; per-user file isolation under `$AIHUB_HOME/users/<userId>/`.
- Web: login, guard, sidebar account/logout, `/admin/users`, `/admin/agents`.
- Integration tests for enabled/disabled modes.
- Tasks 1-8 from PRO-209 implemented; remaining: real Google OAuth smoke test.

### 2026-04-04: PRO-208 adapter wiring + docs update

- Claude + Pi adapters apply scoped OneCLI proxy/CA env per run and restore after.
- Phase 1 + Phase 2 complete; Phase 3 cleanup complete; legacy `secrets.provider="onecli"` path removed.

### 2026-04-04: PRO-208 connector HTTP client factory

- `apps/gateway/src/connectors/http-client.ts`: `createHttpClient()` with OneCLI-aware fetch, scoped proxy env, tokenized proxy URL, CA trust propagation, module-level env lock for concurrent calls.
- Coverage in `__tests__/http-client.test.ts`.

### 2026-04-04: PRO-211 apm create area validation

- `ApiClient.listAreas()`, `apm create --area <area>`, validated against current ids.

### 2026-04-03: PRO-208 OneCLI Phase 1 foundation

- `OnecliCaConfigSchema`, `OnecliAgentConfigSchema`, `OnecliConfigSchema`, top-level `GatewayConfigSchema.onecli`.
- `buildOnecliEnv(config, agentId)` derives proxy + CA env.

### 2026-04-03: PRO-206 connector tool knowledge injection scope 1

- Optional connector-level `systemPrompt` in shared contract.
- `getConnectorPromptsForAgent()` appended to Pi + Claude system prompts.

### 2026-04-03: PRO-199 connector review fixes + runtime integration + shared foundation

- Shared: connector contracts, Zod runtime schemas, in-memory registry, config merge + tool loader with name namespacing, external discovery.
- Gateway: startup discovery + validation, required-secret checks, Pi custom tools + Claude MCP mounts, Zod → JSON Schema for Pi.
- `ConnectorTool.parameters` narrowed to object-shaped Zod.
- Shared `connectors` + per-agent `agent.connectors` config schemas.

### 2026-04-03: follow-ups

- `aihub send` resolves startup config + initializes connectors before running an agent.
- External connector discovery follows symlinks; defaults to `$AIHUB_HOME/connectors`.
- Pi adapter only mounts subagent tools when `projects` component is loaded.
- `ChatView` no longer reloads history on every `isStreaming` transition.
- Gateway logs all agent run failures from shared runner catch.

### 2026-04-02: PRO-198 modular architecture Phase 5 hardening

- Shared `Component.routePrefixes`, static registry metadata for route guards without eager component imports.
- Startup preparation resolves `$env:` / `$secret:` once; `ComponentContext.getConfig()` exposes resolved values.
- Server `/api` disabled-component matcher rebuilt from static metadata.

### 2026-04-02: PRO-198 `apm config migrate` / `validate` CLI

- Pure v1 → v2 migration helper moved into `@aihub/shared`.
- `apm config migrate [--dry-run]` + `apm config validate`.
- `--config` > `$AIHUB_HOME/aihub.json` (default `~/.aihub/aihub.json`); deprecated `AIHUB_CONFIG` fallback.
- Migration does not auto-add `components.amsg` / `components.conversations` unless implied.

### 2026-04-02: PRO-198 Phase 3 + Phase 4

- `api.ts` → `api.core.ts`; removed temporary projects compat mount.
- `/api/*` disabled-component guards → `404 { error: "component_disabled", component }`.
- Web: capabilities store from `/api/capabilities`, sidebar + routes gate on it; `/`, `/projects`, `/conversations` lazy-load component bundles.

### 2026-04-02: PRO-198 Phase 2a simple components

- Real wrappers for scheduler (`/schedules` CRUD), heartbeat (`/agents/:id/heartbeat`), amsg, conversations (listing/detail/message/attachment/project-creation).

### 2026-04-02: PRO-198 Phase 1 foundation

- Shared component contracts + v2 config schemas.
- v1 → v2 runtime migration with warnings; `$env:` / `$secret:` resolvers.
- Lazy component registry + Phase 1 stubs; projects watcher moved into projects component.
- `GET /api/capabilities`; CLI loads → validates → registers routes → starts/stops components.

### 2026-03-30: PRO-164 mobile responsive project detail UI

- `apps/web/src/components/project/ProjectDetailPage.tsx`: `isMobile` @ 768px; compact layout @ 1199px; mobile tabs `Overview/Chat/Activity/Changes/Spec`; `AgentPanel` in mobile Overview; breadcrumb truncation; tablet 280px left rail.
- `AgentPanel.tsx`: mobile row padding + touch targets.

## Older History (Compressed — >2 weeks old)

### 2026-03-13 → 2026-03-22

- SPECS checklist collapse toggle landed (one shared Tasks + Acceptance Criteria collapse).
- Areas homepage quick-create + native color picker; `createArea()` client method.
- Codex `gpt-5.4` added across run-prep UI, CLI validation, gateway server validation.

### 2026-03-09 → 2026-03-12

- PRO-162: Areas overview homepage at `/` with per-area cards, per-status counts, filtered kanban at `/projects?area=<id>`.
- PRO-168: right sidebar `ACTIVE PROJECTS` (replaces `SUBAGENTS`), sorted by recent activity.
- PRO-155: Quick lead-agent chat overlay (FAB + overlay) with unread pulse and persisted last-agent.
- PRO-169: silent `apm exec` diagnostics surfaced — empty shell outputs now emit warning with remediation hint; coordinator prompt got preflight `apm` guidance.

### 2026-03-07 → 2026-03-08

- PRO-174 Space per-entry skip/integrate + delivery `replaces` auto-skip; conflict-fix resume path uses `replaces`.
- PRO-174 frontend: `Rebase on main` + `Fix rebase conflict` space-level controls.

### 2026-03-04 → 2026-03-06

- PRO-170: resume semantics delta-only (no project corpus reinjection), resume/start prompt-size guardrails (32KB / 256KB).
- Space merge-to-main backend + cleanup (`POST /api/projects/:id/space/merge`).
- PRO-166: conflict-fix resumes original worker (in-place conflict entry update).
- PRO-163 Fix 4: subagent post-creation model/config PATCH + `apm rename` + UI selector.
- Coordinator prompt: must dispatch `reviewer` template for review work.
- Inline rename Space-key fix in project agent list.

### 2026-03-03

- Subagent chat remount + stale-poll race hardening; loading flicker fix; realtime fallback polling; Stop/interrupt UX (disabled `Stopping...` + `interrupt_requested_at`).
- Project watcher ID normalization (`PRO-159_slug` → `PRO-159`).
- Project detail stale accessor + selection override fix.
- Prompt/template guardrails: template-locked overrides require `--allow-template-overrides`; worker commits required.
- Spawn form + chat/detail regressions (worktree path preview, controlled tab, long-line overflow).
- Realtime web subscriptions for `file_changed` / `agent_changed`; activity timeline compression; branch diff per-file expand.
- Routing/sidebar fixes; recents from view history; `apm start --template` omits locked fields unless override.

### 2026-03-02

- Worker template worktrees default to `space/<projectId>`.
- Template-based spawn flow + coordinator/worker/reviewer prompt semantics.
- Project detail chat Stop flow (`/abort` lead, interrupt API subagents).
- `SPECS.md` parsing + subsection support.
- Coordinator context injection (main repo + Space path); area-repo fallback.

### 2026-03-01

- Space-first architecture (`space.ts`, queue/integrate/conflict paths, Space-aware changes API).
- Project-detail spawn templates + run-mode `none`; spawn prep moved into center panel.
- CLI harness set consolidated to `claude|codex|pi`.
- Homepage shell/nav/sidebar structure; project detail left/center/right.
- Light/dark theme with global CSS vars.

### 2026-02-28 and earlier

- Projects API/CLI foundations, Kanban board, project detail page, spec editor, task parsing, agent/subagent monitoring, activity feed/chat integration.
- Supporting infra: areas/tasks hierarchy, multi-file project docs, attachments, OpenClaw integration, subagent kill flow, realtime status events, soft-delete, dev helpers.

## Known Risks / Follow-up

- Vitest invocation still tends to run broad suites in this repo config; keep serial runs to avoid transient test flake.
- Realtime correctness depends on watcher/event consistency; if stale UI appears, verify `state.json` write + websocket `agent_changed` path first.
- Continue enforcing template-lock boundaries to prevent CLI/UI drift.
- Harbor eval sandbox has no docker — always ask the user to run `harbor run` and share `jobs/<latest>/.../oracle.txt` output.
