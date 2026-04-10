# Harbor eval engine for AIHub

Vendor-neutral [Harbor](https://www.harborframework.com/) eval infrastructure for AIHub agents.

See `docs/plans/harbor-evals-for-aihub-migration.md` for the full design.

## What lives here

```
base/
  aihub-eval/          # base Docker image every task FROMs (runtime only, no agent config)
agents/
  aihub_installed.py   # generic Harbor BaseInstalledAgent reference wrapper
tasks/
  smoke/               # minimal contract test for the eval CLI
```

This directory provides the **eval engine** — the runtime, base image, and agent wrapper. Product-specific content (tasks, fake sidecars, agent config) lives in the blueprint repo that consumes these artifacts.

## Running the smoke task

Prerequisites: [Harbor](https://www.harborframework.com/docs/getting-started) installed, Docker running.

```bash
# Build the base image (from repo root)
docker build -t aihub-eval-base:local \
  -f examples/harbor/base/aihub-eval/Dockerfile .

# Run the smoke task
harbor run \
  -p examples/harbor/tasks/smoke \
  --agent-import-path examples.harbor.agents.aihub_installed:AIHubInstalledAgent \
  --env docker
```

## For blueprint repos

Blueprint repos (e.g. cloudihub) consume the base image and provide their own:
- Agent config (`aihub.json`, `models.json`, `agents/`, `connectors/`)
- Fake HTTP sidecars for connector stubbing
- Harbor tasks, datasets, and verifiers
- Product-specific agent wrapper with a default agent id

See the plan doc for the full Option C ownership model.
