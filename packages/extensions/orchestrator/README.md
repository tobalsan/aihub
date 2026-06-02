# @aihub/extension-orchestrator

Symphony-aligned Linear orchestrator for AIHub.

## Project config

AIHub config lists project folders only:

```json
{
  "extensions": {
    "orchestrator": {
      "projects": ["./projects/aihub"],
      "concurrency": { "global": 3 }
    }
  }
}
```

Each project folder must contain uppercase `WORKFLOW.md`.

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

## Runtime model

- Tracker scope comes from `WORKFLOW.md` `tracker.project_slug`.
- Linear auth comes from `tracker.api_key`, usually `$LINEAR_API_KEY`.
- Candidate issues are filtered by Linear project `slugId`.
- Workspace directories are per issue under `workspace.root`.
- Core orchestrator does not create git clones or worktrees.
- Repo bootstrap should prefer deterministic hooks/tooling; prompt-driven cloning is allowed only inside the issue workspace.

Useful commands:

```bash
pnpm aihub:dev orchestrator projects
pnpm aihub:dev orchestrator workflow --project <project-id>
pnpm aihub:dev orchestrator tick --project <project-id>
pnpm aihub:dev orchestrator runs --project <project-id>
```
