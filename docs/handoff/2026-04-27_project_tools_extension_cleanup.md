# Project Tools Extension Cleanup

Moved project agent tool ownership back into the `projects` extension.

- Removed hard-coded `project.create`, `project.get`, `project.update`, and `project.comment` registration from `container/agent-runner`.
- Simplified gateway `/internal/tools` to dispatch only through loaded extension tools.
- Added `projectsExtension.getAgentTools()` so both in-process Pi runs and container Pi runs receive project tools only when the projects extension is loaded.
- Added regression coverage for container and in-process runtimes so `project_*` tools are absent unless supplied by the extension path.
