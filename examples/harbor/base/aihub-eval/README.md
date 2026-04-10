# aihub-eval-base

Vendor-neutral base Docker image shared by every Harbor task.

## What it provides

- Node 20 + the `aihub` CLI (built from source)
- Python 3 + pytest (via uv)
- Non-root `agent` user (matches `task.toml [agent].user = "agent"`)
- `AIHUB_HOME=/eval` with a placeholder `aihub.json`
- `/logs/agent/`, `/logs/verifier/`, `/app/out/` preconfigured with correct ownership

## What consuming repos must provide

The base image does **not** include agent config. Blueprint repos must
supply their own `aihub.json`, `models.json`, `agents/`, and
`connectors/` into `/eval` — either via `COPY` in the task Dockerfile
or via bind-mount in `docker-compose.yaml`.

## Build

From the monorepo root (context must include `packages/` + `apps/`):

```bash
docker build -t aihub-eval-base:local \
  -f examples/harbor/base/aihub-eval/Dockerfile .
```

Task images then: `FROM aihub-eval-base:local`
