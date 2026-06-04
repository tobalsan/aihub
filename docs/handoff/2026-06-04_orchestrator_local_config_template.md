# Orchestrator local config template

## Changed

- Updated `scripts/config-template.json` to match current `.aihub/aihub.json` shape:
  - removed deprecated `extensions.projects.orchestrator`
  - added top-level `extensions.orchestrator`
  - uses `projectsRoot: "./projects"`
  - registers `./projects/projectA` and `./projects/projectB`
  - keeps current scheduler, subagent profiles, ports, API URL, and dev agent path
- Replaced legacy project/slice demo seeding in `scripts/create-local-config.js` with orchestrator workflow seeding.
- Seeded projects now contain only `WORKFLOW.md`, matching `.aihub/projects/projectA` and `.aihub/projects/projectB`.
- Generated `WORKFLOW.md` uses `agent.profile: Worker` so it resolves against seeded subagent profiles.

## Validation

- `node --check scripts/create-local-config.js`
- JSON parse of `scripts/config-template.json` after placeholder substitution
