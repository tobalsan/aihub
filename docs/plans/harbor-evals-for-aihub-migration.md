# Harbor Evals for AIHub Migration

Date: 2026-04-06
Owner: Cloud
Status: Option C active — aihub owns eval engine, blueprint repos own tasks

## Goal

Use Harbor as the **eval harness** for migrating CloudifAI agents from the old Python/LangChain architecture to the new AIHub architecture.

The point is not to adopt Harbor as the production runtime.
The point is to use Harbor to create **repeatable, channel-agnostic evals** so each migration step can be tested with TDD-style regression checks.

This aligns with the current AIHub direction:
- agent runtime as the core
- channels as components
- connectors as stateless tools/webhook owners
- agent logic decoupled from specific surfaces

## Recommendation

### Use Harbor for
- task-based agent evals
- local and CI regression suites
- benchmark-style datasets for migrated agents
- deterministic verification where possible
- LLM-as-a-judge for fuzzy support-quality checks
- trajectory capture / later ATIF normalization

### Do not use Harbor for
- production orchestration
- channel routing
- session management
- connector lifecycle
- long-lived agent runtime
- replacing AIHub core

## Why Harbor is a good fit

Harbor’s model is simple and useful for migration work:
- **Task** = instruction + environment + verifier
- **Dataset** = collection of tasks
- **Trial** = one agent attempt
- **Job** = many trials

That is exactly the shape we need for migration evals:
- same business behavior
- same task inputs
- old implementation vs new implementation
- compare rewards, outputs, and traces

Harbor also already supports:
- custom agent integration
- containerized task environments
- custom reward files (`reward.txt` / `reward.json`)
- LLM-as-a-judge verifiers
- artifact collection
- trajectory logging
- local viewing of job results

## Architectural stance

### Correct dependency direction

**AIHub runtime -> Harbor eval wrapper**

Not:

**Harbor agent model -> production runtime design**

We should wrap AIHub agents so Harbor can evaluate them.
We should not force AIHub’s architecture to conform to Harbor internals.

## Proposed integration shape

## 1. AIHub as an Installed Harbor agent

Harbor has two agent integration models: **External** (Python `BaseAgent` on host, reaches container via `exec`) and **Installed** (`BaseInstalledAgent` that lives inside the container image). We use **Installed**.

Rationale:
- Installed agents share the compose network with sidecar services (fake HTTP APIs, MCP servers, etc.). External agents would have to reach those sidecars from the host, which is awkward.
- Installed agents are how Harbor's own integrations work (Claude Code, Codex, OpenHands). We inherit Harbor's `[[environment.mcp_servers]]` autoconfiguration for free if we ever need it.
- Keeps AIHub unaware of Harbor: the only contract is a CLI + a fixed output path.

### Layers

1. **`aihub eval run` CLI** (this repo) — headless entrypoint that runs one agent turn loop with no gateway, no channels, no scheduler. Writes `result.json` + ATIF `trajectory.json` to `/logs/agent/`.
2. **`aihub-eval-base` Docker image** (`examples/harbor/base/aihub-eval/`) — Node + the `aihub` CLI + a minimal `aihub.json` and stub connector path. Task images `FROM` this.
3. **Python `BaseInstalledAgent` subclass** (`examples/harbor/agents/aihub_installed.py`) — ~40 lines. Tells Harbor to `exec_as_agent` the `aihub eval run ...` command inside the container. No business logic.

### Non-responsibilities
- Discord/Slack/amsg — not booted
- production message threading, persistent chats, scheduler — not booted
- Harbor-side concerns (trial retries, parallelism, sandbox provider) — handled by `harbor run`

## 2. `aihub eval run` CLI contract

### Flags

```bash
aihub eval run \
  --agent <id>                                # agent defined in aihub.json (required)
  --instruction-file <path>                   # required, path inside container
  --output <path>                             # default: /logs/agent/result.json
  --trace <path>                              # default: /logs/agent/trajectory.json
  [--config <path>]                           # default: $AIHUB_HOME/aihub.json
  [--model <override>]                        # optional override of agent's configured model
  [--max-turns <n>]                           # optional safety cap
  [--timeout-sec <n>]                         # optional wall-clock cap
```

### Behavior

- Loads `aihub.json`, resolves the agent, boots a **minimal runtime**: connectors + skills + agent session only. No gateway HTTP server, no Discord/amsg/scheduler components.
- Reads `instruction-file`, runs one agent turn loop to completion.
- Exits `0` on a completed run (even if the agent produced a "wrong" answer — that's the verifier's job), non-zero only on infra errors (bad config, bad agent id, fatal runtime crash).
- Agent config (model, provider, thinkLevel, connectors, auth) is the source of truth — `--model` is only a per-run override for sweeps.

### `result.json` shape

```json
{
  "status": "completed",
  "agent": "sales-admin",
  "model": "anthropic/claude-sonnet-4-6",
  "finalMessage": "...",
  "toolCalls": [
    {
      "name": "cloudifi_admin.list_companies",
      "arguments": { "extraFields": false },
      "result": { "total": 12, "companies": [ ... ] },
      "ok": true,
      "durationMs": 142
    }
  ],
  "metrics": {
    "durationMs": 18234,
    "inputTokens": 1200,
    "outputTokens": 340,
    "costUsd": 0.023
  },
  "artifacts": [
    { "path": "/app/out/renewals.json", "type": "file" }
  ]
}
```

This is the stable contract between AIHub and anything running evals against it. Verifier scripts in `tests/test.sh` read this file; they should never import AIHub internals.

### `trajectory.json` shape

ATIF-native from day 1 (no converter phase). Harbor provides Pydantic models for ATIF; we emit the same schema directly from the TS runner. See Section 3.

## 3. Native ATIF trajectories

Previously this was planned as "emit native → add converter later". Collapsed: **emit ATIF directly**.

Why: Harbor ships first-class Pydantic models for the Agent Trajectory Interchange Format (`harbor.models.trajectories`). Terminus-2 / Claude Code / OpenHands integrations already produce ATIF. A second AIHub-native format plus a converter is extra code and drift risk for no benefit — the schema is stable and well-documented.

### Implementation

- Add a minimal TS ATIF writer in `packages/evals/` (or under `apps/gateway/src/evals/`) that constructs an ATIF `Trajectory` object as the agent runs and dumps it to `/logs/agent/trajectory.json` at the end.
- No Python dependency — we're just writing JSON that conforms to the documented schema version (`ATIF-v1.4` at time of writing).
- Harbor validates `trajectory.json` against its Pydantic models during result collection, so schema drift will fail loudly.

### Minimum fields

- `schema_version`, `session_id`
- `agent`: name, version, model name
- Ordered `steps`: system prompt, user instruction, assistant messages, tool calls, tool results
- Per-step and `final_metrics`: token counts, cost
- `status`, termination reason

## 4. Connector stubbing: Strategy B (HTTP sidecar + baseUrl override)

Connectors are how sales_admin actually does its job (Cloudi-Fi admin API, Hiveage billing). Evals must stub them. We considered three strategies:

- **A — Stub connector module**: ship an alternate connector implementation under the same id with fixture JSON. Fast, zero prod changes, but leaves real HTTP / auth / pagination / Zod response parsing **untested**. Migration bugs in the connector layer hide in evals and surface in staging.
- **B — HTTP sidecar + `baseUrl` override**: real connector code calls a fake HTTP service running as a docker-compose sidecar. Exercises the actual fetch/auth/pagination/error-mapping paths. ← **chosen**
- **C — MCP sidecar**: skip for now. Loses coverage of real connector code.

### What Strategy B buys us

- The connector's real `fetch()` calls run. Real headers, real URL building, real retries, real error class mapping.
- The real Zod response schemas parse fake responses — any drift between the TS model and the actual API shape fails loudly in evals.
- Write-path tasks (`create_invoice`, `create_estimate`) can assert on **inbound request payloads captured by the fake**, not just the agent's final message.
- The fake's `/etc/hosts`-level realism lets us also validate auth flows (token refresh, JWT expiry handling).

### What it costs

- Per-connector fake HTTP server (Python FastAPI or Node Hono, fixture-driven). Mitigated by sharing a base fake image per connector and having tasks override only specific fixtures.
- 5–15s extra per-trial startup for compose boot. Mitigated with tiny/pre-built sidecar images.
- Multi-container tasks only run on Harbor's `--env docker` (not Daytona/Modal/E2B/Runloop yet). Acceptable: local + CI covers our first wave.
- Some connectors may need a small config refactor to accept a `baseUrl` override. `cloudifi_admin` already accepts `adminApiBase` / `coreApiBase`, so the first task needs **zero** connector changes.

### First concrete stub: `cloudifi_admin`

`cloudifi_admin` is the first real stub, because:
1. It's what `sales_admin.renewals` / `quota_analysis` actually call.
2. It already supports `adminApiBase` + `coreApiBase` config fields — no connector refactor required.
3. It has a non-trivial auth flow (`/auth/json` → `/api/2/login/refresh` → JWT) that's worth exercising.

The fake must implement at minimum:
- `POST /auth/json` — returns a signed-looking JWT (may be a static placeholder since the connector decodes `exp`)
- `POST /api/2/login/refresh` — returns `{ tokenid, ttl }`
- `GET /companies?disable_company_filter=true` — returns Hydra-shaped company list from fixture
- `GET /api/2/reports/subscriptions?dimensions=company&start-date=...&end-date=...` — returns quota report from fixture

### Fixture layout

```
examples/harbor/base/fakes/cloudifi-admin/
  Dockerfile
  server.py                 # FastAPI app, reads /fixtures/*.json
  fixtures/                 # base fixtures (overridable per task)
    companies.json
    quota_report.json
```

Tasks mount or `COPY` their own fixtures over the base ones:

```
examples/harbor/tasks/sales-admin-renewals/environment/
  Dockerfile                # FROM aihub-eval-base
  docker-compose.yaml       # adds fake-cloudifi-admin sidecar + overrides fixtures
  fixtures/cloudifi-admin/companies.json
```

### What this keeps

All the original goals — fast, reproducible, cheap, debuggable, no real services — with the added realism of actually running the connector code we're migrating.

## Eval suite design

## Suite A — Core channel-agnostic behaviors

These prove the architectural migration is real.

### A1. Single-turn classification
Given a support request, classify intent/category/priority.

Verifier:
- deterministic JSON assertion

### A2. Structured action selection
Given an input, decide which connector/tool to call.

Verifier:
- assert expected tool chosen
- assert no forbidden tools called

### A3. Tool result synthesis
Given a mocked tool result, produce the correct user-facing response.

Verifier:
- exact or schema-based response checks

### A4. Error handling and fallback
Tool fails / returns malformed data / empty result.

Verifier:
- graceful fallback present
- no hallucinated success

### A5. Multi-step reasoning with artifacts
Agent must call tool(s), transform data, and write a file/output.

Verifier:
- file exists
- schema valid
- content correct

## Suite B — CloudifAI migration scenarios

These map to actual business workflows.

### B1. Zendesk ticket triage
Input: ticket text + metadata.
Output: label / route / summary / draft reply.

### B2. Resolution summary generation
Input: ticket thread + internal notes.
Output: concise resolution summary.

### B3. Knowledge retrieval answer
Input: support question.
Tool: mocked knowledge search / Onyx-like retrieval.
Output: answer grounded in returned docs.

### B4. Sales qualification / routing
Input: inbound prospect message.
Output: classification + next action + optional CRM payload.

### B5. Slack-style conversational follow-up without Slack coupling
Input: prior thread transcript as plain text/messages.
Output: correct next reply.

Key point: model the behavior, not the surface.

## Suite C — Connector and tool contract tests

These are not full agent evals. They are narrower tests ensuring AIHub connector semantics remain stable.

### C1. Connector prompt injection sanity
Assert agent receives the right tool descriptions / SOP hints.

### C2. Tool argument schema fidelity
Assert emitted arguments conform to connector schema.

### C3. Webhook-to-agent trigger contract
For connectors that own inbound hooks, assert normalized event -> agent input mapping.

## Verifier strategy

## Prefer deterministic verification when possible

Use plain shell / Python / pytest checks for:
- files written
- JSON shape
- exact routes/classifications
- selected tools
- presence/absence of phrases
- numeric metrics

## Use LLM-as-a-judge only for fuzzy output quality

Good use cases:
- response tone
- summary quality
- whether a reply is helpful / concise / grounded
- comparing multiple acceptable outputs

### Rule of thumb
If you can write an assert, do not use a judge.
If many outputs are valid, use a judge.

## Suggested directory structure in AIHub repo

```text
docs/
  plans/
    harbor-evals-for-aihub-migration.md

examples/
  harbor/
    base/
      aihub-eval/
        Dockerfile                # Node + aihub CLI, FROM by every task
        aihub.json                # minimal agent config used inside eval containers
        connectors/               # (optional) production connectors to symlink into image
      fakes/
        cloudifi-admin/
          Dockerfile
          server.py               # FastAPI fake, fixture-driven
          fixtures/
    agents/
      aihub_installed.py          # Harbor BaseInstalledAgent wrapper (~40 lines)
    tasks/
      sales-admin/                # dataset.toml + metric.py live here
        dataset.toml
        metric.py
        sales-admin-renewals/
          instruction.md
          task.toml
          environment/
            Dockerfile            # FROM aihub-eval-base
            docker-compose.yaml   # adds fake-cloudifi-admin sidecar
            fixtures/cloudifi-admin/companies.json
          solution/
            solve.sh              # oracle path, writes expected result.json directly
          tests/
            test.sh               # reads /logs/agent/result.json, writes reward.json
            test_outputs.py       # pytest assertions
        sales-admin-quota-analysis/
        sales-admin-renewal-estimate-preview/
        sales-admin-arr-mrr-report/
        sales-admin-tool-selection/

apps/gateway/
  src/
    evals/                        # aihub eval run CLI lives here (or packages/evals if promoted)
      cli.ts
      runtime.ts                  # minimal runtime boot (connectors + agent, no components)
      trajectory.ts               # ATIF writer
```

Rationale:
- Harbor-facing content lives under `examples/harbor/` so it's discoverable and obviously external.
- `aihub eval run` CLI source lives in `apps/gateway/src/evals/` next to the runtime it re-uses (connector loader, agent session). Promote to `packages/evals` only if another package needs to depend on it.
- Datasets are Harbor's aggregation unit. Putting the 5 first tasks under `examples/harbor/tasks/sales-admin/` with a `dataset.toml` + `metric.py` means `harbor run -p examples/harbor/tasks/sales-admin` just works.

## Proposed AIHub implementation tasks

## Task 1 — `aihub eval run` CLI

Build the headless entrypoint per Section 2. Scope:

- New subcommand under the existing `aihub` CLI
- New `apps/gateway/src/evals/` module with:
  - `cli.ts` — flag parsing, orchestration
  - `runtime.ts` — minimal boot that re-uses existing `loadConfig`, connector loader, and agent session runner, but **skips**: HTTP server, Discord/amsg/scheduler/heartbeat component init, multi-user auth, gateway bind
  - `trajectory.ts` — ATIF writer
- Exit contract: `0` for any completed run, non-zero only on infra errors
- `result.json` and `trajectory.json` written atomically at end of run

Must **not** require:
- Discord / amsg / Slack
- gateway daemon or open ports
- scheduler
- production config sprawl

## Task 2 — Harbor installed agent

`examples/harbor/agents/aihub_installed.py` — subclass of `BaseInstalledAgent`:

- `install()` — no-op (aihub is baked into `aihub-eval-base`)
- `run()` — `exec_as_agent(env, command="aihub eval run --agent <id> --instruction-file /app/instruction.md")`
- `populate_context_post_run()` — read `/logs/agent/result.json`, set `cost_usd` + token counts on `AgentContext`; surface `trajectory.json` as an ATIF trajectory

Agent id is passed via a task-level config knob (e.g., `[metadata]` in `task.toml` or a Harbor agent kwarg). Default: `sales-admin`.

## Task 3 — `aihub-eval-base` image

`examples/harbor/base/aihub-eval/Dockerfile`:

- `FROM node:20-slim`
- Install `aihub` CLI (from this repo's package, either via pnpm link or published tarball)
- Copy a minimal `aihub.json` defining the agents to be evaluated and pointing `connectors.path` at production connectors
- `ENV AIHUB_HOME=/eval`
- `WORKDIR /app`
- No `CMD` — Harbor's installed agent invokes `aihub eval run` explicitly

## Task 4 — First sales_admin task (`sales-admin-renewals`)

Full Harbor task with:
- `instruction.md` — natural-language task description
- `task.toml` — metadata + `[verifier.env]` for injecting deterministic clock
- `environment/Dockerfile` — `FROM aihub-eval-base`, `COPY fixtures /eval/fixtures`
- `environment/docker-compose.yaml` — adds `fake-cloudifi-admin` sidecar, sets connector env overrides via `aihub.json` merge or env vars
- `solution/solve.sh` — oracle path that writes a correct `result.json` directly (bypasses the agent) — lets us prove the verifier works before the agent does
- `tests/test.sh` + `tests/test_outputs.py` — read `/logs/agent/result.json`, assert renewals content, write `/logs/verifier/reward.json`

This is the concrete starting PR. Subsequent sales_admin tasks reuse the same base image + sidecar and just swap fixtures and assertions.

## Task 5 — Fake `cloudifi_admin` HTTP sidecar

`examples/harbor/base/fakes/cloudifi-admin/`:
- `Dockerfile` — tiny Python image with FastAPI + uvicorn
- `server.py` — implements the 4 endpoints listed in Section 4 ("First concrete stub"), reads fixtures from `/fixtures/` mounted into the container
- `fixtures/companies.json`, `fixtures/quota_report.json` — base fixtures

The fake issues a JWT with `exp` set far in the future so the connector's token manager accepts it. Auth is validated cursorily (accept any non-empty Bearer token on subsequent calls) — tightening auth realism is a follow-up.

## Task 6 — Dataset metric

`examples/harbor/tasks/sales-admin/dataset.toml` + `metric.py`:
- `metric.py` reads `rewards.jsonl`, emits `{ "pass_rate": float, "mean_reward": float, "per_task": { ... } }`
- Enables `harbor run -p examples/harbor/tasks/sales-admin --agent-import-path examples.harbor.agents.aihub_installed:AIHubInstalledAgent` → single-line summary comparable across model/prompt sweeps

## Task 7 — Remaining sales_admin tasks

After Task 4 proves the loop, add:
- `sales-admin-quota-analysis`
- `sales-admin-renewal-estimate-preview`
- `sales-admin-arr-mrr-report`
- `sales-admin-tool-selection` (top-level `agent.sales_admin` routing eval)

`renewal_estimate.create` is deferred until the fake Hiveage sidecar exists — writes are riskier and deserve a separate task.

## Task 8 — CI entrypoint

Add a lightweight CI path:
- PR CI: run the deterministic sales_admin dataset on `--env docker`
- local/manual: full suite with judge-based tasks (none yet, but the path will exist)
- nightly: broader model sweep via `--model` override

## Migration workflow

For each migrated agent/workflow:

1. Describe expected behavior as Harbor task(s)
2. Make sure the old implementation passes or establish baseline
3. Implement the AIHub version
4. Run same Harbor dataset
5. Compare scores and traces
6. Only then swap production traffic

This turns migration into:
- behavior-first
- regression-safe
- model-agnostic
- channel-agnostic

## First concrete eval set — sales_admin (Wave 0)

Why sales_admin first: high-signal, read-heavy workflows with a single dominant connector (`cloudifi_admin`) that already supports `baseUrl` overrides. Write-path tasks (`renewal_estimate.create`) are deferred to a later wave once the fake Hiveage sidecar exists.

### 1. sales-admin-renewals ← **first concrete PR**

**Input**
- Instruction: "List all customer companies with a renewal coming up in the next 30 days. Return a JSON array with company id, name, billing date, and days until renewal, sorted by days until renewal ascending."
- Fixture: `companies.json` with ~10 companies, some inside and some outside the 30-day window
- Deterministic clock injected via `[verifier.env]` or a sidecar that reports a fixed "now"

**Expected output**
- `/app/out/renewals.json` containing the filtered + sorted list
- Final message naming the count

**Verification** (fully deterministic)
- `result.json.toolCalls` includes exactly one `cloudifi_admin.list_companies` call (or an acceptable superset)
- `/app/out/renewals.json` is valid JSON matching the schema `[{id, name, billingDate, daysUntilRenewal}]`
- Contents match the expected fixture-derived set
- No calls to forbidden tools (e.g., `create_invoice`)

### 2. sales-admin-quota-analysis

**Input**
- Instruction: "Which companies used more than 80% of their quota between 2026-01-01 and 2026-03-31?"
- Fixtures: `companies.json` + `quota_report.json`

**Expected output**
- JSON array of `{companyId, usagePercent}` sorted descending
- Exactly the companies above the threshold

**Verification**
- Deterministic JSON comparison
- Required tool calls: `cloudifi_admin.get_quota_usage` with the specified date range

### 3. sales-admin-renewal-estimate-preview

**Input**
- Instruction: "Build a renewal estimate preview for company ACME-42 for the next billing period."
- Fixtures: company ACME-42 in `companies.json` with a specific plan + usage

**Expected output**
- Line-items array with the expected subscription + overage lines
- Preview total matches fixture-derived expected number

**Verification**
- Exact line-item assertion on the agent's final structured response
- No actual `create_estimate` call (preview only)

### 4. sales-admin-arr-mrr-report

**Input**
- Instruction: "Generate the ARR/MRR report for 2026-Q1 and save it to /app/out/arr-mrr.json."
- Fixtures: companies + quota report

**Expected output**
- File at `/app/out/arr-mrr.json` with schema `{ arr, mrr, by_company: [...] }`
- Totals match fixture-derived expected numbers

**Verification**
- File exists, schema valid, numeric totals within epsilon of expected

### 5. sales-admin-tool-selection

**Input**
- A series of ambiguous user messages ("how are we doing this quarter?", "what's coming up for renewal?", "can you show me quota usage?")
- No sidecar mutations needed

**Expected output**
- Agent picks the correct sub-workflow / tool for each message
- Multi-turn is allowed but not required

**Verification**
- Assert which tool name appears first in `result.json.toolCalls`
- Assert forbidden tools are absent

## What success looks like

We should consider this effort successful when:
- AIHub agents can be evaluated without any channel dependency
- a Harbor dataset can be run locally against AIHub agents with one command
- at least 5 high-signal CloudifAI tasks exist
- deterministic smoke evals can run in CI
- traces are rich enough to debug failures
- the eval suite catches regressions during migration

## Risks

### Risk 1 — Overfitting to the eval harness
Mitigation:
- keep tasks tied to business behavior, not implementation details

### Risk 2 — Too much LLM judge usage
Mitigation:
- use deterministic verifiers by default
- reserve judges for fuzzy outputs only

### Risk 3 — Shim accidentally depends on production gateway machinery
Mitigation:
- keep `aihub eval run` minimal and isolated
- no channel components required

### Risk 4 — Real workflows differ from sandbox tasks
Mitigation:
- keep a small set of end-to-end staging tests outside Harbor
- Harbor remains the core regression suite, not the only validation layer

## Recommendation summary

The right move is:
- **AIHub remains the runtime**
- **Harbor becomes the eval harness**
- **ATIF becomes the trace target**
- **CloudifAI migration proceeds behavior-first via datasets/tasks**

That gives us the thing we currently lack: a clean, repeatable way to prove the AIHub migration is actually preserving or improving agent behavior.

## Next steps

1. Implement `aihub eval run`
2. Create Harbor adapter for AIHub agents
3. Build first 5 tasks
4. Add deterministic smoke suite to CI
5. Add baseline-vs-migrated comparison script
6. Decide whether to make ATIF export native or adapter-based

## Option C — Migration to cloudihub Ownership (ACTIVE)

> **Option A (spike) is retired.** Option C is now the active ownership model.
> Migration completed 2026-04-10.

Option A was the spike shape: all four Harbor task layers colocated in `aihub`.
Option C is the active ownership model now that the spike is proven.
The split is simple:

1. **AIHub owns the eval engine**
   - `aihub eval run`
   - `apps/gateway/src/evals/`
   - `aihub-eval-base`
   - fake sidecars that exercise connector code
2. **cloudihub owns the evaluated blueprint**
   - `config/aihub.json`
   - `config/models.json`
   - `config/agents/sally/**`
   - Harbor task specs, datasets, verifiers, oracle solutions

That keeps the dependency direction correct:

- `cloudihub` depends on published `aihub` eval artifacts
- `aihub` does **not** vendor or own `cloudihub` production prompts/config long-term

### Why migrate

The migration is not cosmetic. It fixes ownership boundaries that Option A intentionally blurs during the spike.

#### 1. Correct ownership per layer

A Harbor task is four layers glued together:

1. **Eval runtime** — `aihub eval run`, ATIF trajectory emission, result shaping, base image
2. **Fake sidecars** — connector-level HTTP stubs used by Harbor tasks
3. **Agent config** — `aihub.json`, `models.json`, `agents/sally/**`, prompt files, skills, workspace state
4. **Task spec** — `task.toml`, dataset, verifier, oracle solution, compose wiring

The right owners are:

- Layers **1-2**: `aihub`
- Layers **3-4**: `cloudihub`

Option A temporarily colocates all four layers under `examples/harbor/` because that is the fastest way to prove the integration loop.
Option C restores the intended boundary after the loop is stable.

#### 2. Vendored snapshot drift is guaranteed if we do not migrate

If `aihub` keeps a copy of `cloudihub` agent config under `examples/harbor/base/aihub-eval/cloudihub-config/`, drift becomes normal:

- prompts change in `cloudihub`, eval snapshot does not
- skills change in `cloudihub`, eval snapshot does not
- connector enablement changes in `cloudihub`, eval snapshot does not
- model defaults change in `cloudihub`, eval snapshot does not

Then Harbor passes stop meaning "the current blueprint is healthy".
They only mean "the vendored snapshot inside `aihub` is healthy".
That is the wrong regression signal.

#### 3. Single source of truth for agent prompts and skills

The production blueprint should own the exact files being evaluated.
That means:

- prompt edits happen once
- skill wiring happens once
- model routing changes happen once
- Harbor regressions evaluate the same config that production uses

Any other setup creates double maintenance.
Double maintenance always turns into stale evals.

#### 4. The pattern must generalize beyond cloudihub

`aihub` is the engine, not the only blueprint.
If Harbor support is useful, we should be able to apply the same pattern to future blueprints without copying their agent configs into `aihub`.

Option C gives a reusable rule:

- `aihub` publishes runtime artifacts and fake sidecars
- each blueprint repo owns its Harbor tasks and agent config

That scales to future blueprint repos without turning `aihub/examples/harbor/` into a dumping ground of product-specific task suites.

#### 5. CI ownership belongs with the thing being protected

The sales-admin Harbor suite is a regression gate on `cloudihub` behavior.
That gate should fail when:

- prompts regress
- skills regress
- agent config regresses
- model changes regress behavior

Those are `cloudihub` changes.
So the blocking CI job belongs in `cloudihub`, not in `aihub`.

`aihub` CI should only protect the runtime contract it owns:

- the CLI still works
- the base image still builds
- the fake sidecars still respond
- the smoke reference task still passes

### Exit criteria from Option A

Do **not** migrate early.
Option C starts only when Option A has proved the engine contract and the first wave of tasks is solid.
All of the following must be green at the same time.

#### 1. `aihub eval run` CLI is stable for a full two-week window

Definition:

- no breaking flag changes to the core contract
- no breaking output shape changes in `result.json`
- no breaking trace-path changes for `trajectory.json`
- no required changes to Harbor's installed-agent wrapper

Stable contract means this still works unchanged for two weeks:

```bash
aihub eval run \
  --agent sally \
  --instruction-file /app/instruction.md \
  --output /logs/agent/result.json \
  --trace /logs/agent/trajectory.json
```

If the contract still churns, do not move tasks yet.

#### 2. All five sales-admin Harbor tasks exist and pass locally with oracle solve

Minimum task set:

- `sales-admin-renewals`
- `sales-admin-quota-analysis`
- `sales-admin-renewal-estimate-preview`
- `sales-admin-arr-report` or `sales-admin-arr-mrr-report` depending on the finalized name
- one tool-selection / routing task

For each task, the oracle path must prove the verifier is correct independently of the real agent.
Example shape:

```bash
harbor run \
  -p examples/harbor/tasks/sales-admin/sales-admin-renewals \
  --agent oracle
```

The exact Harbor flags may vary by local wrapper, but the requirement does not: the verifier must pass with the oracle solution for all five tasks.

#### 3. At least one task passes end-to-end with the real `aihub eval run`

Not oracle.
Not a mocked verifier-only path.
A real task must pass with:

- the Harbor installed agent
- `aihub eval run`
- the real connector code
- the fake sidecar
- task verifier consuming `result.json`

Minimum proof command shape:

```bash
harbor run \
  -p examples/harbor/tasks/sales-admin/sales-admin-renewals \
  --agent-import-path examples.harbor.agents.aihub_installed:AIHubInstalledAgent \
  --env docker
```

At least one such task must be green before we copy task ownership into `cloudihub`.

#### 4. Token and cost metrics are plumbed into ATIF final metrics

The data path must exist end-to-end:

- `RunAgentResult.meta`
- eval runtime aggregation
- `trajectory.json`
- ATIF `final_metrics`

This matters because once tasks move out of repo, the artifact contract becomes the only shared truth.
If token/cost accounting is still incomplete, freeze the split until it is wired.

#### 5. `aihub-eval-base` image is publishable from a clean checkout

Required proof:

- multi-stage build works from a clean repo clone
- no hidden local symlinks
- no untracked files required
- no dependence on adjacent repos

Passing shape:

```bash
docker build \
  -f examples/harbor/base/aihub-eval/Dockerfile \
  .
```

If a fresh checkout cannot reproduce the image, cloudihub cannot depend on it safely.

#### 6. Fake sidecar images are pinnable and tagged

At minimum:

- `cloudifi-admin`
- `hiveage` when tasks need it

Requirement:

- image build is reproducible
- image is published or otherwise distributable
- tasks can pin an exact version tag

No floating `latest`.
No implicit local-only images.

### Target layout after migration

After Option C, the repos should look like this.

#### `aihub` repo after migration

What stays in `aihub`:

```text
examples/harbor/
├── base/
│   ├── aihub-eval/           # base image + Dockerfile + publish script
│   └── fakes/
│       ├── cloudifi-admin/   # HTTP stub
│       └── hiveage/          # HTTP stub (future)
└── tasks/
    └── smoke/                # minimal reference task exercising the CLI
```

Also stays in `aihub`:

```text
apps/gateway/src/evals/
```

That directory continues to own:

- CLI entrypoint
- minimal runtime boot
- result shaping
- trajectory emission

The important point: `aihub` keeps one tiny Harbor-facing reference task, not the full product regression suite.

#### `cloudihub` repo after migration

What moves into `cloudihub`:

```text
harbor/
└── tasks/
    └── sales-admin/
        ├── sales-admin-renewals/
        │   ├── task.toml
        │   ├── environment/{Dockerfile,docker-compose.yaml}
        │   ├── tests/
        │   ├── solution/solve.sh
        │   └── dataset.toml
        ├── sales-admin-quota-analysis/
        ├── sales-admin-arr-report/
        └── ... (5 total)
```

Agent config does **not** move into `harbor/`.
It stays in the normal blueprint config location:

```text
config/aihub.json
config/models.json
config/agents/sally/**
```

Task environment images in `cloudihub` should:

- `FROM ghcr.io/thinh/aihub-eval-base:<pinned>`
- consume the published fake sidecar images by exact tag
- source `config/` into `/eval`

Default local-dev shape:

```bash
docker compose -f eval/harbor/tasks/sales-admin/sales-admin-renewals/environment/docker-compose.yaml up --build
```

The source of truth for prompts and skills remains `config/agents/sally/**`, not a copied eval-only snapshot.

### Dependency contract between repos

Option C only works if the repo boundary is explicit.
`cloudihub` must depend on stable `aihub` artifacts, not on `aihub` source checkout conventions.

#### 1. `aihub-eval-base` image

Published artifact, pinned by tag.
Preferred registry form:

```text
ghcr.io/thinh/aihub-eval-base:$version
```

Fallback if registry distribution is unavailable:

- export a local tarball with `docker save`
- check it into a release artifact bucket or a hermetic storage location
- load it in CI with `docker load`

But the contract is the same either way: `cloudihub` consumes an exact image version.

Task Dockerfile shape:

```Dockerfile
FROM ghcr.io/thinh/aihub-eval-base:<tag>
```

#### 2. Fake sidecar images

Same rule.
Published artifacts, pinned by tag.
Example shape:

```text
ghcr.io/thinh/fakes-cloudifi-admin:$version
```

Or equivalent registry naming if the publish workflow chooses a different prefix.
The key point is exact pinning, not the final repository name.

Compose file shape:

```yaml
services:
  fake-cloudifi-admin:
    image: ghcr.io/thinh/fakes-cloudifi-admin:<tag>
```

#### 3. CLI interface stability

The stable runtime contract between repos is the CLI invocation shape.

```bash
aihub eval run \
  --agent X \
  --instruction-file Y \
  --output Z \
  --trace T
```

Breaking that contract after Option C requires a versioned rollout.
The simplest rule:

- breaking CLI contract => major version bump of `aihub-eval-base`
- non-breaking additive flags => minor version bump
- image rebuild with no contract change => patch version bump

That keeps cloudihub tasks pinned until they intentionally upgrade.

#### 4. ATIF schema version

ATIF schema is part of the cross-repo contract.
Current target:

```text
ATIF v1.4
```

`aihub` owns that schema emission because `trajectory.json` is produced by the runtime.
If the emitted schema changes, that is an `aihub` contract change and should be versioned with the base image.

#### 5. Things `cloudihub` must not depend on

After migration, `cloudihub` depends on **none** of the following:

- `aihub` source code checkout
- `aihub/node_modules`
- an adjacent sibling clone of the `aihub` repo
- unpublished local images with implicit names
- shell scripts copied out of a developer workstation

If a task requires the `aihub` repo to be cloned next door, the split is not complete.

### Agent workspace sourcing

This is the central operational question.
When a Harbor task runs in `cloudihub`, how do `agents/sally/**` and the rest of `config/` get into `/eval` inside the container?

There are three viable choices.

#### Option 1 — `COPY` at build time

Example shape:

```Dockerfile
COPY ../../../config /eval
```

Implications:

- Docker build context must be the `cloudihub` repo root
- image bakes the agent config in at build time
- output is reproducible and hermetic
- build is tightly coupled to repo layout and context invocation

Pros:

- hermetic image
- no runtime path assumptions
- good for air-gapped CI

Cons:

- awkward build context requirements
- config edit requires image rebuild
- easier to accidentally break with repo layout changes

#### Option 2 — bind-mount at run time

Example compose shape:

```yaml
services:
  task:
    volumes:
      - ../../../config:/eval:ro
```

Implications:

- no config duplication
- local edits are instantly visible
- CI only needs to check out `cloudihub`; relative path resolves inside that repo

Pros:

- zero duplication
- simplest local developer loop
- aligns with config as source of truth
- no image rebuild for prompt/skill changes

Cons:

- relies on repo-relative path conventions
- less hermetic than baking config into the image

This should be the **default** for Option C.
It matches the reason we are migrating in the first place: the task should evaluate the live blueprint config without copying it.

#### Option 3 — monorepo-aware bake step

This means some larger build system bakes task image plus config from a monorepo-aware context.
For current needs, this is overkill.

Pros:

- can be elegant in a monorepo

Cons:

- extra build machinery
- solves a problem we do not currently have
- not aligned with the actual repo topology

Do not choose this now.

#### Recommendation

Default to **Option 2: bind-mount at run time**.

Why:

- it keeps `config/` as the one source of truth
- it avoids vendoring prompt/skill snapshots
- it is the lightest migration from Option A
- it works in local dev and in CI as long as `cloudihub` checks out itself

For stricter hermetic CI, allow Option 1 as an explicit variant.
That should be a CI/environment choice, not the default developer workflow.

#### Path configurability

To avoid hardcoding one repo layout forever, support an override env var in compose, e.g.:

```yaml
services:
  task:
    volumes:
      - ${CLOUDIHUB_CONFIG_DIR:-../../../config}:/eval:ro
```

That keeps the default path simple while still allowing non-standard local layouts.

### CI wiring

After migration, the repos should have different CI responsibilities.

#### `aihub` CI

Purpose: protect the runtime contract.

What it runs:

1. build `aihub-eval-base`
2. build fake sidecar images
3. run the minimal smoke task under `examples/harbor/tasks/smoke/`

Example command shape:

```bash
harbor run -p examples/harbor/tasks/smoke --agent-import-path examples.harbor.agents.aihub_installed:AIHubInstalledAgent --env docker
```

What this proves:

- `aihub eval run` still boots
- result and trajectory files are emitted
- base image is healthy
- fake sidecar image is healthy
- Harbor wrapper contract still works

What `aihub` CI does **not** own after migration:

- the full sales-admin regression suite
- cloudihub prompt changes
- cloudihub skill changes
- cloudihub model-routing regressions

Release behavior on tagged releases:

- publish `ghcr.io/thinh/aihub-eval-base:<tag>`
- publish fake sidecar images such as `cloudifi-admin:<tag>`

#### `cloudihub` CI

Purpose: protect blueprint behavior.

On every PR, run Harbor against the pinned `aihub-eval-base` tag.
Command shape:

```bash
harbor run eval/harbor/tasks/sales-admin/*
```

Or equivalent explicit loop if Harbor prefers one task path at a time.
The important part is:

- use the pinned `aihub-eval-base` image
- run the real task suite owned by `cloudihub`
- block PR merge on failures

What this catches:

- prompt regressions
- skill regressions
- agent config regressions
- model default regressions
- task-spec regressions

That is the correct ownership split for CI.

### Migration mechanics

The migration should happen as a sequence of small, reviewable PRs.
Each step has one owner and one repo.
Do not combine the whole move into one giant diff.

#### 1. `aihub` PR — publish runtime images

Scope:

- add tagged Docker build + publish workflow for `aihub-eval-base`
- add tagged Docker build + publish workflow for `fakes/cloudifi-admin`
- verify images land in registry

Acceptance proof:

```bash
docker pull ghcr.io/thinh/aihub-eval-base:<tag>
docker pull ghcr.io/thinh/fakes-cloudifi-admin:<tag>
```

Outcome:

- cloudihub has something stable to pin before any task move starts

#### 2. `aihub` PR — extract minimal smoke task

Scope:

- add `examples/harbor/tasks/smoke/`
- keep it tiny and runtime-focused
- run `aihub eval run` against a no-op or minimal reference agent
- add it to `aihub` CI

Acceptance proof:

```bash
harbor run -p examples/harbor/tasks/smoke --agent-import-path examples.harbor.agents.aihub_installed:AIHubInstalledAgent --env docker
```

Outcome:

- `aihub` retains a self-owned Harbor contract test after the product tasks move out

#### 3. `cloudihub` PR — move first sales-admin task

Scope:

- add `eval/harbor/tasks/sales-admin/sales-admin-renewals/` by copying the proven task from `aihub`
- update task Dockerfile to use the published base image tag
- update compose to bind-mount `../../../config` into `/eval`
- update any task-local paths in `task.toml`, verifier scripts, and compose files
- verify `harbor run` passes locally

Required task image shape:

```Dockerfile
FROM ghcr.io/thinh/aihub-eval-base:<tag>
```

Required compose shape:

```yaml
volumes:
  - ${CLOUDIHUB_CONFIG_DIR:-../../../config}:/eval:ro
```

Acceptance proof:

```bash
harbor run -p eval/harbor/tasks/sales-admin/sales-admin-renewals --agent-import-path eval.harbor.agents.aihub_installed:AIHubInstalledAgent --env docker
```

Outcome:

- first real proof that cross-repo ownership works

#### 4. `cloudihub` PR — move remaining four sales-admin tasks

Scope:

- copy the remaining four tasks
- apply the same base-image pinning pattern
- apply the same config mount pattern
- verify each task locally

Acceptance proof:

```bash
harbor run -p eval/harbor/tasks/sales-admin --agent-import-path eval.harbor.agents.aihub_installed:AIHubInstalledAgent --env docker
```

Outcome:

- the full blueprint-owned task suite lives in the blueprint repo

#### 5. `cloudihub` PR — wire Harbor into PR CI

Scope:

- add Harbor eval step to `cloudihub` CI
- pin the `aihub-eval-base` tag explicitly
- make failures block PRs

Acceptance proof:

- open a PR with the Harbor job required
- confirm the job runs from a clean checkout
- confirm the job uses only published images plus the checked-out `cloudihub` repo

Outcome:

- `cloudihub` now owns its own regression gate

#### 6. `aihub` PR — cleanup old product-owned copies

Scope:

- delete `examples/harbor/tasks/sales-admin/`
- delete `examples/harbor/base/aihub-eval/cloudihub-config/`
- delete `scripts/sync-cloudihub-config.sh`
- update docs that still describe Option A as the long-term layout

Outcome:

- no more vendored blueprint snapshot inside `aihub`

#### 7. `aihub` PR — mark Option C active in this plan

Scope:

- update this document
- mark Option A retired
- mark Option C active
- keep the smoke-task ownership note explicit

Outcome:

- documentation matches the real repo split

### Risks and mitigations

#### Risk — `cloudihub` CI becomes slow

Cause:

- Harbor docker startup
- base image pulls
- multiple task environments

Mitigation:

- cache base-image layers in CI
- cache fake sidecar layers in CI
- run Harbor tasks in parallel where the harness allows it
- keep smoke coverage in `aihub`, not duplicated in `cloudihub`

#### Risk — registry outage blocks `cloudihub` CI

Cause:

- pinned base image or fake sidecar image cannot be pulled

Mitigation:

- support `docker load` fallback from a local tarball or release artifact
- keep a last-known-good image reference available
- avoid floating tags so the fallback artifact is unambiguous

#### Risk — CLI breaking change strands `cloudihub` on an old contract

Cause:

- `aihub eval run` flags or output contract changes without version discipline

Mitigation:

- semver the `aihub-eval-base` image contract
- require major version bump for breaking changes
- emit deprecation warnings before removing old flags where practical
- keep `aihub` smoke task exercising the stable contract

#### Risk — fake sidecars drift from real connector behavior

Cause:

- fake HTTP responses diverge from production API semantics over time

Mitigation:

- add contract tests in `aihub` CI as follow-up work
- replay recorded production requests against the fake where safe
- assert field-level equivalence on critical responses
- keep fakes next to connector code so connector owners update them together

This is future work, but it is the right long-term guardrail.

#### Risk — bind-mount path assumptions break for some developers

Cause:

- non-standard checkout layout
- Harbor invoked from a different working directory than expected

Mitigation:

- use `CLOUDIHUB_CONFIG_DIR` env override in compose
- document the default relative path clearly
- keep Option 1 (`COPY` at build time) available for hermetic CI or unusual local setups

### Non-goals

Option C is deliberately narrow.
It is **not** trying to do the following:

- generalize this pattern to every third-party eval harness
- auto-generate Harbor tasks from prompts, skills, or connector schemas
- run Harbor tasks against production traffic
- treat Harbor as a production orchestration layer
- collapse `cloudihub` into the `aihub` repo just to simplify Docker context handling

This plan is Harbor-specific and regression-test-specific.
That focus is a feature, not a limitation.
