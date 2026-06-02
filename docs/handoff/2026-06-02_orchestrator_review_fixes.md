# Orchestrator Review Fixes

- Killed orchestrator runs now call `finishRun(..., "killed")` and emit `orchestrator.run.finished`.
- Linear terminal-state release now stops the active subagent before hooks/workspace cleanup.
- Gateway websocket broker now forwards orchestrator events to connected realtime clients.
- Regression tests added in `packages/extensions/orchestrator/src/orchestrator.test.ts` and `apps/gateway/src/server/status-ws.test.ts`.
