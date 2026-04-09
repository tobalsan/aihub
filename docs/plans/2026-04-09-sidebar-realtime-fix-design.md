# PRO-219: Sidebar Real-Time Fix — Design

**Date:** 2026-04-09
**Status:** Approved

## Problem

The sidebar's LEAD AGENTS status pill and ACTIVE PROJECTS list don't update in real-time. Both event paths exist in code but fail silently.

## Root Cause

`subscribeToStatus()` in `apps/web/src/api/client.ts` creates a bare WebSocket with **no reconnection, no `onclose` handler, no retry**. When the WS drops (network blip, gateway restart, tab suspend), status updates silently stop forever. `subscribeToFileChanges()` already handles this correctly with a 1s reconnect timer — the status subscriber never got the same treatment.

Secondary issues:
- No `onclose` handler — disconnects go undetected
- Race condition between initial `fetchAgentStatuses()` and WS connect
- No global/shared socket — each mount creates a new WS

## Approach: Option B — Add reconnection to `subscribeToStatus` independently

Keep two separate WS connections but add the same reconnect/retry logic from `subscribeToFileChanges()` to `subscribeToStatus()`. Smaller diff, lower risk. The two WS connections serve different purposes (status is subscription-based with access control filtering; file changes broadcast to all).

Do NOT unify into a single WS — that would require reworking the server-side subscription model.

## Scope 1: Debug & Fix

### Changes

**`apps/web/src/api/client.ts` — `subscribeToStatus()`:**
- Add `onclose` handler that triggers reconnection (mirror `scheduleFileChangeReconnect()` pattern)
- Add reconnect timer with 1s delay
- Guard against duplicate connections on rapid remount
- Use module-level socket variable (like `fileChangeSocket`) instead of per-call instantiation

**`apps/web/src/components/AgentDirectory.tsx`:**
- Refetch statuses on WS reconnect to catch missed events during disconnect

**`apps/gateway/src/server/index.ts` — `setupEventBroadcast()`:**
- Add `[ws]` prefixed debug logging behind `DEBUG=aihub:ws` env var for status + agent_changed broadcasts

**`apps/web/src/api/client.ts` — WS handlers:**
- Add `[ws]` prefixed debug logging behind `localStorage.getItem('debug')` check for received events

**`apps/gateway/src/server/index.ts` — new endpoint:**
- `GET /api/debug/events` — returns last 50 emitted events from a circular buffer on `agentEventBus`

## Scope 2: E2E Verification

Create `scripts/verify-sidebar.sh` that:
- Sets up temp `AIHUB_HOME` with test config
- Starts gateway + web UI
- Uses `agent-browser` CLI for browser assertions (status pill changes, active projects appear/disappear)
- Reports pass/fail per step, cleans up on exit

## Scope 3: Regression Tests

Add integration tests (no browser) that verify:
- `emitStatusChange()` → WS client receives the event
- Project watcher detects `state.json` change → emits `agent_changed`
- Reconnection logic recovers after WS close

Run in CI with `pnpm test:gateway` and `pnpm test:web`.
