# aihub-eval-base

Base Docker image shared by every Harbor task under `examples/harbor/tasks/`.

## What it provides

- Node 20 + pnpm
- Non-root `agent` user (matches `task.toml [agent].user = "agent"`)
- `AIHUB_HOME=/eval` with a minimal `aihub.json` defining the agents that get evaluated
- `/logs/agent/`, `/logs/verifier/`, `/app/out/` preconfigured with correct ownership

## What it does NOT provide (yet)

- The actual `aihub` CLI binary. This PR scaffolds the directory + config;
  the `aihub eval run` CLI itself is Task 1 of the plan and lands in a
  follow-up commit. Once it exists, uncomment the install lines in the
  Dockerfile and rebuild.

## Build

```bash
docker build -t aihub-eval-base:local examples/harbor/base/aihub-eval
```

## aihub.json

The baked `aihub.json` points every connector at eval-only hostnames
(`fake-cloudifi-admin`, `fake-hiveage`, …). Tasks provide those hostnames
via `environment/docker-compose.yaml` sidecars. No real external services
are ever contacted from inside an eval container.
