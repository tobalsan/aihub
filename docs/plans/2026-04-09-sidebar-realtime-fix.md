# PRO-219: Sidebar Real-Time Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the sidebar's real-time status updates (LEAD AGENTS pill + ACTIVE PROJECTS list) and add debug tooling + regression tests.

**Architecture:** Add reconnection logic to `subscribeToStatus()` mirroring the existing `subscribeToFileChanges()` pattern (module-level socket, subscriber set, reconnect-on-close timer). Add debug logging behind flags on both gateway and client. Add `/api/debug/events` endpoint backed by a circular buffer on `agentEventBus`. Add integration tests for the WS event paths.

**Tech Stack:** TypeScript, SolidJS (web), Hono (gateway), WebSocket (`ws`), Vitest, chokidar

---

## Task 1: Add reconnection to `subscribeToStatus()` (client-side fix)

**Files:**
- Modify: `apps/web/src/api/client.ts:391-515`
- Test: `apps/web/src/api/client.status-ws.test.ts` (create)

**Step 1: Write the failing test**

Create `apps/web/src/api/client.status-ws.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

describe("subscribeToStatus reconnection", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reconnects after WebSocket close", async () => {
    const { subscribeToStatus } = await import("./client");

    const statuses: Array<{ agentId: string; status: string }> = [];
    const unsubscribe = subscribeToStatus({
      onStatus: (agentId, status) => statuses.push({ agentId, status }),
    });

    // First connection
    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].simulateOpen();
    expect(MockWebSocket.instances[0].sent).toContain(
      JSON.stringify({ type: "subscribeStatus" })
    );

    // Simulate close — should trigger reconnect
    MockWebSocket.instances[0].simulateClose();

    // Advance past reconnect timer (1s)
    vi.advanceTimersByTime(1000);

    // New connection should be created
    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.instances[1].simulateOpen();

    // Should still receive events on new connection
    MockWebSocket.instances[1].simulateMessage({
      type: "status",
      agentId: "test-agent",
      status: "streaming",
    });
    expect(statuses).toEqual([
      { agentId: "test-agent", status: "streaming" },
    ]);

    unsubscribe();
  });

  it("does not reconnect after explicit unsubscribe", async () => {
    const { subscribeToStatus } = await import("./client");

    const unsubscribe = subscribeToStatus({ onStatus: () => {} });
    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].simulateOpen();

    unsubscribe();
    vi.advanceTimersByTime(1000);

    // Should NOT create a new connection
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("shares a single socket across multiple subscribers", async () => {
    const { subscribeToStatus } = await import("./client");

    const statuses1: string[] = [];
    const statuses2: string[] = [];

    const unsub1 = subscribeToStatus({
      onStatus: (_id, s) => statuses1.push(s),
    });
    const unsub2 = subscribeToStatus({
      onStatus: (_id, s) => statuses2.push(s),
    });

    // Should share one socket
    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateMessage({
      type: "status",
      agentId: "a",
      status: "streaming",
    });

    expect(statuses1).toEqual(["streaming"]);
    expect(statuses2).toEqual(["streaming"]);

    // Unsubscribe one — socket stays open
    unsub1();
    expect(MockWebSocket.instances[0].readyState).not.toBe(
      MockWebSocket.CLOSED
    );

    // Unsubscribe last — socket closes
    unsub2();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/web/src/api/client.status-ws.test.ts`
Expected: FAIL — current `subscribeToStatus` has no reconnection, no shared socket.

**Step 3: Implement the fix**

Replace `subscribeToStatus()` in `apps/web/src/api/client.ts` (lines 489-515) with a shared-socket pattern mirroring `subscribeToFileChanges()`. Replace the existing code block from `const statusSubscribers...` (if absent, add before `subscribeToStatus`) through end of `subscribeToStatus`:

```typescript
const statusCallbackSubscribers = new Set<StatusCallbacks>();
let statusSocket: WebSocket | null = null;
let statusReconnectTimer: number | undefined;

function clearStatusReconnectTimer(): void {
  if (statusReconnectTimer !== undefined) {
    window.clearTimeout(statusReconnectTimer);
    statusReconnectTimer = undefined;
  }
}

function scheduleStatusReconnect(): void {
  if (statusCallbackSubscribers.size === 0) return;
  if (statusReconnectTimer !== undefined) return;
  statusReconnectTimer = window.setTimeout(() => {
    statusReconnectTimer = undefined;
    if (statusCallbackSubscribers.size > 0) {
      connectStatusSocket();
    }
  }, 1000);
}

function disconnectStatusSocket(): void {
  clearStatusReconnectTimer();
  const socket = statusSocket;
  statusSocket = null;
  if (!socket) return;
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "unsubscribeStatus" }));
  }
  socket.close();
}

function connectStatusSocket(): void {
  if (statusCallbackSubscribers.size === 0) return;
  if (
    statusSocket &&
    (statusSocket.readyState === WebSocket.OPEN ||
      statusSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  const ws = new WebSocket(getWsUrl());
  statusSocket = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "subscribeStatus" }));
  };

  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "status") {
      for (const subscriber of statusCallbackSubscribers) {
        subscriber.onStatus?.(event.agentId, event.status);
      }
    } else if (event.type === "error") {
      for (const subscriber of statusCallbackSubscribers) {
        subscriber.onError?.(event.message);
      }
    }
  };

  ws.onerror = () => {
    for (const subscriber of statusCallbackSubscribers) {
      subscriber.onError?.("Status subscription connection error");
    }
  };

  ws.onclose = () => {
    if (statusSocket === ws) {
      statusSocket = null;
    }
    scheduleStatusReconnect();
  };
}

/**
 * Subscribe to global agent status updates.
 * Receives real-time status changes for all agents.
 * Uses a shared socket with automatic reconnection.
 */
export function subscribeToStatus(callbacks: StatusCallbacks): () => void {
  statusCallbackSubscribers.add(callbacks);
  connectStatusSocket();

  return () => {
    statusCallbackSubscribers.delete(callbacks);
    if (statusCallbackSubscribers.size === 0) {
      disconnectStatusSocket();
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/web/src/api/client.status-ws.test.ts`
Expected: PASS

**Step 5: Run existing tests to check for regressions**

Run: `pnpm test:web`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/client.status-ws.test.ts
git commit -m "fix(web): add reconnection to subscribeToStatus WS

subscribeToStatus now uses a shared socket with automatic 1s
reconnect-on-close, mirroring the subscribeToFileChanges pattern.
Fixes sidebar status pill going stale after WS disconnect."
```

---

## Task 2: Refetch statuses on WS reconnect

**Files:**
- Modify: `apps/web/src/api/client.ts` (add `onReconnect` callback to `StatusCallbacks`)
- Modify: `apps/web/src/components/AgentDirectory.tsx:91-98`

**Step 1: Add onReconnect callback**

In `apps/web/src/api/client.ts`, add `onReconnect` to `StatusCallbacks` type (line 391-394):

```typescript
export type StatusCallbacks = {
  onStatus?: (agentId: string, status: "streaming" | "idle") => void;
  onError?: (error: string) => void;
  onReconnect?: () => void;
};
```

In `connectStatusSocket()`, fire `onReconnect` after a successful reconnect. Track whether this is the first connection with a module-level flag:

```typescript
let statusHasConnectedOnce = false;
```

In the `ws.onopen` handler inside `connectStatusSocket()`, after sending `subscribeStatus`:

```typescript
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "subscribeStatus" }));
  if (statusHasConnectedOnce) {
    for (const subscriber of statusCallbackSubscribers) {
      subscriber.onReconnect?.();
    }
  }
  statusHasConnectedOnce = true;
};
```

Reset `statusHasConnectedOnce = false` in `disconnectStatusSocket()`.

**Step 2: Update AgentDirectory to refetch on reconnect**

In `apps/web/src/components/AgentDirectory.tsx` lines 91-98, add `onReconnect`:

```typescript
createEffect(() => {
  const unsubscribe = subscribeToStatus({
    onStatus: (agentId, status) => {
      setStatuses((prev) => ({ ...prev, [agentId]: status }));
    },
    onReconnect: () => {
      fetchAgentStatuses().then((res) => {
        setStatuses(res.statuses);
      });
    },
  });
  onCleanup(unsubscribe);
});
```

**Step 3: Run tests**

Run: `pnpm test:web`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/components/AgentDirectory.tsx
git commit -m "fix(web): refetch agent statuses on WS reconnect

AgentDirectory now refetches statuses when the status WS reconnects,
catching any events missed during the disconnect window."
```

---

## Task 3: Add debug logging (gateway + client)

**Files:**
- Modify: `apps/gateway/src/server/index.ts:352-410` (setupEventBroadcast)
- Modify: `apps/web/src/api/client.ts` (connectStatusSocket, connectFileChangeSocket)

**Step 1: Add gateway-side debug logging**

In `apps/gateway/src/server/index.ts`, add at the top of the file (near other imports):

```typescript
const wsDebug = process.env.DEBUG?.includes("aihub:ws");
```

In `setupEventBroadcast()`, add logging inside each event handler:

After line 375 (`agentEventBus.onStatusChange((event) => {`):
```typescript
if (wsDebug) console.log(`[ws] statusChange: ${event.agentId} → ${event.status} (${statusSubscribers.size} subscribers)`);
```

After line 399 (`agentEventBus.onFileChanged((event) => {`):
```typescript
if (wsDebug) console.log(`[ws] fileChanged: ${event.projectId}/${event.file} (${connectedClients.size} clients)`);
```

After line 405 (`agentEventBus.onAgentChanged((event) => {`):
```typescript
if (wsDebug) console.log(`[ws] agentChanged: ${event.projectId} (${connectedClients.size} clients)`);
```

**Step 2: Add client-side debug logging**

In `apps/web/src/api/client.ts`, add near the top:

```typescript
const wsDebug = () => localStorage.getItem("debug")?.includes("aihub:ws");
```

In `connectStatusSocket()` `ws.onmessage`, before dispatching:
```typescript
if (wsDebug()) console.log("[ws] status received:", event.agentId, event.status);
```

In `connectStatusSocket()` `ws.onclose`:
```typescript
if (wsDebug()) console.log("[ws] status socket closed, scheduling reconnect");
```

In `connectFileChangeSocket()` `ws.onmessage`, before dispatching:
```typescript
if (wsDebug()) console.log("[ws] file event received:", payload.type, payload.projectId);
```

**Step 3: Run tests**

Run: `pnpm test:web && pnpm test:gateway`
Expected: PASS (debug logs are gated behind flags)

**Step 4: Commit**

```bash
git add apps/gateway/src/server/index.ts apps/web/src/api/client.ts
git commit -m "feat(debug): add [ws] debug logging behind aihub:ws flag

Gateway: DEBUG=aihub:ws env var enables broadcast logging.
Client: localStorage debug=aihub:ws enables receive logging."
```

---

## Task 4: Add `/api/debug/events` endpoint

**Files:**
- Modify: `apps/gateway/src/agents/events.ts` (add circular buffer)
- Modify: `apps/gateway/src/server/index.ts` (add route)
- Test: `apps/gateway/src/server/debug-events.api.test.ts` (create)

**Step 1: Write the failing test**

Create `apps/gateway/src/server/debug-events.api.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";

describe("/api/debug/events", () => {
  let tmpDir: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  let server: ReturnType<typeof import("./index.js").startServer>;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-debug-events-"));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify({
        agents: [
          {
            id: "test-agent",
            name: "Test",
            workspace: "~/test",
            model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
          },
        ],
      })
    );

    vi.resetModules();
    const serverMod = await import("./index.js");
    server = serverMod.startServer(0, "127.0.0.1");
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve();
      server.once("listening", () => resolve());
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns recent events", async () => {
    const { agentEventBus } = await import("../agents/events.js");
    agentEventBus.emitStatusChange({ agentId: "test-agent", status: "streaming" });
    agentEventBus.emitStatusChange({ agentId: "test-agent", status: "idle" });

    const res = await fetch(`http://127.0.0.1:${port}/api/debug/events`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.events).toBeInstanceOf(Array);
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    expect(body.events[body.events.length - 1]).toMatchObject({
      type: "statusChange",
      data: { agentId: "test-agent", status: "idle" },
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/gateway/src/server/debug-events.api.test.ts`
Expected: FAIL — no such endpoint.

**Step 3: Add circular buffer to AgentEventBus**

In `apps/gateway/src/agents/events.ts`, add to the `AgentEventBus` class:

```typescript
private recentEvents: Array<{ type: string; data: unknown; timestamp: number }> = [];
private maxRecentEvents = 50;

recordEvent(type: string, data: unknown) {
  this.recentEvents.push({ type, data, timestamp: Date.now() });
  if (this.recentEvents.length > this.maxRecentEvents) {
    this.recentEvents.shift();
  }
}

getRecentEvents() {
  return [...this.recentEvents];
}
```

Update each `emit*` method to also call `this.recordEvent(...)`:

```typescript
emitStatusChange(event: AgentStatusChangeEvent) {
  this.recordEvent("statusChange", event);
  this.emit("statusChange", event);
}

emitFileChanged(event: ProjectFileChangedEvent) {
  this.recordEvent("fileChanged", event);
  this.emit("fileChanged", event);
}

emitAgentChanged(event: ProjectAgentChangedEvent) {
  this.recordEvent("agentChanged", event);
  this.emit("agentChanged", event);
}
```

(Leave `emitStreamEvent` alone — stream events are high-volume and contain message content.)

**Step 4: Add the route**

In `apps/gateway/src/server/index.ts`, find where API routes are defined. Add:

```typescript
app.get("/api/debug/events", (c) => {
  return c.json({ events: agentEventBus.getRecentEvents() });
});
```

Make sure `agentEventBus` is imported (it should already be via the existing `setupEventBroadcast` usage).

**Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run apps/gateway/src/server/debug-events.api.test.ts`
Expected: PASS

**Step 6: Run full gateway tests**

Run: `pnpm test:gateway`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/gateway/src/agents/events.ts apps/gateway/src/server/index.ts apps/gateway/src/server/debug-events.api.test.ts
git commit -m "feat(gateway): add /api/debug/events endpoint

Returns last 50 emitted events (statusChange, fileChanged,
agentChanged) from a circular buffer for manual debugging."
```

---

## Task 5: E2E sidebar verification script

**Files:**
- Create: `scripts/verify-sidebar.sh`

**Step 1: Create the verification script**

Create `scripts/verify-sidebar.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# PRO-219: E2E verification for sidebar real-time updates
# Prerequisites: pnpm, agent-browser CLI

TMPDIR=$(mktemp -d)
trap 'kill $GATEWAY_PID $WEB_PID 2>/dev/null; rm -rf "$TMPDIR"' EXIT

echo "=== PRO-219 Sidebar Verification ==="
echo "Temp dir: $TMPDIR"

# 1. Generate config
mkdir -p "$TMPDIR/.aihub" "$TMPDIR/agents/test-agent" "$TMPDIR/projects"
cat > "$TMPDIR/.aihub/aihub.json" <<'CONF'
{
  "version": 2,
  "gateway": { "port": 0 },
  "ui": { "enabled": false },
  "projects": { "root": "TMPDIR_PLACEHOLDER/projects" },
  "agents": [{
    "id": "test-agent",
    "name": "Test Agent",
    "model": { "provider": "openai", "model": "gpt-5.4-mini" },
    "sdk": "pi",
    "workspace": "TMPDIR_PLACEHOLDER/agents/test-agent"
  }]
}
CONF
sed -i'' -e "s|TMPDIR_PLACEHOLDER|$TMPDIR|g" "$TMPDIR/.aihub/aihub.json"

# 2. Start gateway
export HOME="$TMPDIR"
export USERPROFILE="$TMPDIR"
export DEBUG="aihub:ws"

pnpm aihub gateway --dev > "$TMPDIR/gateway.log" 2>&1 &
GATEWAY_PID=$!

# Wait for gateway to report port
for i in $(seq 1 30); do
  GATEWAY_PORT=$(grep -oP 'on [\d.]+:\K\d+' "$TMPDIR/gateway.log" 2>/dev/null || true)
  if [ -n "$GATEWAY_PORT" ]; then break; fi
  sleep 0.5
done

if [ -z "$GATEWAY_PORT" ]; then
  echo "FAIL: Gateway did not start within 15s"
  cat "$TMPDIR/gateway.log"
  exit 1
fi
echo "Gateway running on port $GATEWAY_PORT"

# 3. Start web UI
VITE_API_URL="http://127.0.0.1:$GATEWAY_PORT" pnpm --filter @aihub/web dev --port 0 > "$TMPDIR/web.log" 2>&1 &
WEB_PID=$!

for i in $(seq 1 30); do
  WEB_PORT=$(grep -oP 'localhost:\K\d+' "$TMPDIR/web.log" 2>/dev/null || true)
  if [ -n "$WEB_PORT" ]; then break; fi
  sleep 0.5
done

if [ -z "$WEB_PORT" ]; then
  echo "FAIL: Web UI did not start within 15s"
  cat "$TMPDIR/web.log"
  exit 1
fi
echo "Web UI running on port $WEB_PORT"

UI_URL="http://127.0.0.1:$WEB_PORT"
PASS=0
FAIL=0

report() {
  local result=$1 step=$2
  if [ "$result" = "PASS" ]; then
    echo "  ✓ $step"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $step"
    FAIL=$((FAIL + 1))
  fi
}

# 4. Verification steps (using agent-browser)
echo ""
echo "--- Step 1: Verify sidebar shows Test Agent IDLE ---"
agent-browser navigate "$UI_URL" --wait-for "Test Agent"
SCREENSHOT=$(agent-browser screenshot --output "$TMPDIR/step1.png")
if agent-browser query "Is there a 'Test Agent' with an 'IDLE' status visible?" --screenshot "$SCREENSHOT"; then
  report PASS "Sidebar shows Test Agent IDLE"
else
  report FAIL "Sidebar shows Test Agent IDLE"
fi

echo ""
echo "--- Step 2: Trigger agent run ---"
curl -s -X POST "http://127.0.0.1:$GATEWAY_PORT/api/agents/test-agent/messages" \
  -H "Content-Type: application/json" \
  -d '{"message":"Say hello"}' > /dev/null

echo ""
echo "--- Step 3: Verify status changes to WORKING ---"
sleep 2
SCREENSHOT=$(agent-browser screenshot --output "$TMPDIR/step3.png")
if agent-browser query "Is the Test Agent status showing 'WORKING' or 'running'?" --screenshot "$SCREENSHOT"; then
  report PASS "Status pill changed to WORKING"
else
  report FAIL "Status pill changed to WORKING"
fi

echo ""
echo "--- Step 4: Wait for completion and verify IDLE ---"
for i in $(seq 1 30); do
  STATUS=$(curl -s "http://127.0.0.1:$GATEWAY_PORT/api/agents/test-agent/status" | grep -o '"status":"[^"]*"' | head -1)
  if echo "$STATUS" | grep -q "idle"; then break; fi
  sleep 1
done
sleep 1
SCREENSHOT=$(agent-browser screenshot --output "$TMPDIR/step4.png")
if agent-browser query "Is the Test Agent status showing 'IDLE'?" --screenshot "$SCREENSHOT"; then
  report PASS "Status reverted to IDLE"
else
  report FAIL "Status reverted to IDLE"
fi

echo ""
echo "--- Step 5: Check debug events endpoint ---"
EVENTS=$(curl -s "http://127.0.0.1:$GATEWAY_PORT/api/debug/events")
if echo "$EVENTS" | grep -q "statusChange"; then
  report PASS "/api/debug/events returns status events"
else
  report FAIL "/api/debug/events returns status events"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

**Step 2: Make executable and commit**

```bash
chmod +x scripts/verify-sidebar.sh
git add scripts/verify-sidebar.sh
git commit -m "test(e2e): add sidebar real-time verification script

scripts/verify-sidebar.sh spins up a temp AIHub instance, triggers
agent runs, and verifies sidebar status pill updates via agent-browser."
```

---

## Task 6: Integration tests for event paths (regression prevention)

**Files:**
- Modify: `apps/gateway/src/server/status-ws.test.ts` (add reconnect scenario)
- Modify: `apps/gateway/src/projects/watcher.events.test.ts` (add agent_changed test)

**Step 1: Add reconnection integration test**

Append to `apps/gateway/src/server/status-ws.test.ts`, inside the first `describe` block (after the existing `it`):

```typescript
it("client receives events after reconnecting", async () => {
  // First connection
  const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve) => ws1.once("open", () => resolve()));
  ws1.send(JSON.stringify({ type: "subscribeStatus" }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Close first connection
  const close1 = new Promise<void>((resolve) => ws1.once("close", () => resolve()));
  ws1.close();
  await close1;

  // Second connection (simulating reconnect)
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const received: Array<{ type: string; agentId: string; status: string }> = [];
  const receivePromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
    ws2.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        agentId?: string;
        status?: string;
      };
      if (msg.type === "status") {
        received.push({
          type: msg.type,
          agentId: msg.agentId ?? "",
          status: msg.status ?? "",
        });
        if (received.length === 1) {
          clearTimeout(timeout);
          resolve();
        }
      }
    });
  });

  await new Promise<void>((resolve) => ws2.once("open", () => resolve()));
  ws2.send(JSON.stringify({ type: "subscribeStatus" }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const sessionId = `reconnect-${Date.now()}`;
  setSessionStreaming("status-agent", sessionId, true);

  await receivePromise;

  const close2 = new Promise<void>((resolve) => ws2.once("close", () => resolve()));
  ws2.close();
  await close2;

  expect(received).toEqual([
    { type: "status", agentId: "status-agent", status: "streaming" },
  ]);

  // Cleanup
  setSessionStreaming("status-agent", sessionId, false);
});
```

**Step 2: Add agent_changed watcher test**

Append to `apps/gateway/src/projects/watcher.events.test.ts`:

```typescript
describe("project watcher agent_changed events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockWatchers.length = 0;
  });

  it("emits agent_changed when state.json changes in sessions dir", async () => {
    const watcher = startProjectWatcher({
      projects: { root: "/tmp/projects" },
    } as GatewayConfig);

    const sessionsWatcher = mockWatchers[1];
    expect(sessionsWatcher).toBeDefined();

    sessionsWatcher.emitAll(
      "change",
      "/tmp/projects/PRO-200_test/sessions/worker-a/state.json"
    );

    vi.advanceTimersByTime(300);

    expect(agentEventBus.emitAgentChanged).toHaveBeenCalledTimes(1);
    expect(agentEventBus.emitAgentChanged).toHaveBeenCalledWith({
      type: "agent_changed",
      projectId: "PRO-200",
    });

    await watcher.close();
  });

  it("debounces rapid state.json changes for same project", async () => {
    const watcher = startProjectWatcher({
      projects: { root: "/tmp/projects" },
    } as GatewayConfig);

    const sessionsWatcher = mockWatchers[1];

    sessionsWatcher.emitAll(
      "change",
      "/tmp/projects/PRO-200_test/sessions/worker-a/state.json"
    );
    sessionsWatcher.emitAll(
      "change",
      "/tmp/projects/PRO-200_test/sessions/worker-b/state.json"
    );

    vi.advanceTimersByTime(300);

    // Should only emit once due to debounce
    expect(agentEventBus.emitAgentChanged).toHaveBeenCalledTimes(1);

    await watcher.close();
  });
});
```

**Step 3: Run tests**

Run: `pnpm test:gateway`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/gateway/src/server/status-ws.test.ts apps/gateway/src/projects/watcher.events.test.ts
git commit -m "test(gateway): add regression tests for WS reconnect and agent_changed

- Status WS test verifies events arrive after client reconnects
- Watcher test verifies agent_changed fires on state.json changes
  and debounces rapid changes for the same project."
```

---

## Task 7: Update documentation

**Files:**
- Modify: `docs/llms.md` (update sidebar event-driven refresh notes)
- Modify: `docs/handoff.md` (add PRO-219 completion notes)

**Step 1: Update docs**

In `docs/llms.md`, find the line about `subscribeToStatus` or sidebar event-driven refresh and update to note the reconnection behavior.

In `docs/handoff.md`, add a section noting PRO-219 is complete with the key changes.

**Step 2: Commit**

```bash
git add docs/llms.md docs/handoff.md
git commit -m "docs: update sidebar real-time event flow docs for PRO-219"
```

Now let me update the SPECS.md with the task breakdown.

<function_calls>
<invoke name="Read">
<parameter name="file_path">/Users/thinh/projects/PRO-219_sidebar_still_not_updating_in_real_time/SPECS.md