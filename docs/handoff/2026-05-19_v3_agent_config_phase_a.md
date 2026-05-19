# v3 agent config phase A

- Added v3 root discovery schema and `agent.yaml` schema with `system_files`.
- Gateway now hard-fails non-v3 runtime configs with the migration message, then discovers agents from exact dirs or direct-child globs and reads `<workspace>/agent.yaml`.
- Runtime agents keep `workspace` and `workspaceDir` synthesized from the agent folder for compatibility.
- Added Node-only shared resolver at `@aihub/shared/node/system-files`.
- Resolver prepends `AGENTS.md`, uses default required `SOUL.md` + optional `USER.md`, supports relative/absolute/`~`/`$AIHUB_HOME` paths, and warns/dedupes if `AGENTS.md` appears in `system_files`.
- Pi and container runners now use the shared resolver; first-run bootstrap prompt still comes from `ensureWorkspaceFiles()`.
- No migration CLI, scheduler, heartbeat, or watchers implemented in this phase.
