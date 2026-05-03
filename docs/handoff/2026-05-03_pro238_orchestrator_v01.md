# PRO-238 Orchestrator v0.1

Implemented the opt-in projects orchestrator daemon for Worker auto-pull on `todo`.

- Added `source: "manual" | "orchestrator"` to project subagent spawn input, persisted session config, per-project list output, and global list output.
- Added `packages/extensions/projects/src/orchestrator/` with config parsing, dispatcher slot accounting, and daemon tick loop.
- Dispatcher only counts running orchestrator-sourced runs, ignores manual runs, and dispatches the configured `Worker` profile for eligible `todo` projects.
- Wired daemon start/stop into the projects extension lifecycle when `extensions.projects.orchestrator.enabled` is true.
- Added dispatcher unit tests covering slot accounting, source filtering, and dispatch decisions.
