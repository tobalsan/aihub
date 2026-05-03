# Board Refresh Storm Fix

## Summary

Board project overview no longer subscribes to `agent_changed` websocket events. It still refreshes on project file changes and `subagent_changed` lifecycle events.

## Root Cause

Running subagents append stream events to session logs. The projects watcher emits `agent_changed` for those writes, and `ProjectsOverview` previously treated that as a full board refresh signal, causing repeated `/api/board/projects` refetches while any subagent streamed.

## Approach

Chosen fix: client-side decoupling. `ProjectsOverview` ignores per-agent session file noise and leaves `agent_changed` for consumers that need project detail/subagent panel updates. A regression test covers that `onAgentChanged` is not wired to board refetch.
