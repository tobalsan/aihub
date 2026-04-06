# Harbor eval tasks for AIHub

This directory contains [Harbor](https://www.harborframework.com/) tasks used to eval AIHub agents during the CloudifAI → AIHub migration.

See `docs/plans/harbor-evals-for-aihub-migration.md` for the full design.

## Layout

```
base/
  aihub-eval/          # base Docker image every task FROMs
  fakes/               # shared fake HTTP sidecars per connector
agents/
  aihub_installed.py   # Harbor BaseInstalledAgent wrapper
tasks/
  sales-admin/         # Wave 0 dataset (sales_admin workflows)
```

## Running locally

Prerequisites: [Harbor](https://www.harborframework.com/docs/getting-started) installed, Docker running.

```bash
# Build the base image once
docker build -t aihub-eval-base:local examples/harbor/base/aihub-eval

# Run the sales-admin dataset
harbor run \
  -p examples/harbor/tasks/sales-admin \
  -a aihub-installed \
  --env docker
```

## Connector stubbing

Tasks run real connector code against fake HTTP sidecars (strategy B).
Each connector gets one shared fake under `base/fakes/<connector>/`; tasks
override specific fixtures in `tasks/<task>/environment/fixtures/<connector>/`.
