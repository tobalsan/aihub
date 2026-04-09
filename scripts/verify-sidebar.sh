#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/aihub-sidebar-verify.XXXXXX")
AIHUB_HOME_DIR="$TMP_DIR/aihub-home"
LOG_DIR="$TMP_DIR/logs"
CONFIG_DIR="$AIHUB_HOME_DIR"
CONFIG_PATH="$CONFIG_DIR/aihub.json"
GATEWAY_LOG="$LOG_DIR/gateway.log"
WEB_LOG="$LOG_DIR/web.log"
MOCK_LOG="$LOG_DIR/mock-openclaw.log"
BROWSER_SESSION="verify-sidebar-$$"
TEST_PROJECT_DIR="$TMP_DIR/projects/PRO-TEST_sidebar_test"
TEST_SESSIONS_DIR="$TEST_PROJECT_DIR/sessions"
TEST_SESSION_DIR="$TEST_SESSIONS_DIR/worker-test"
TEST_PROJECT_LABEL="PRO-TEST: Sidebar Test Project"
PASS_COUNT=0
FAIL_COUNT=0
GATEWAY_PID=""
WEB_PID=""
MOCK_PID=""

if [[ -f "$ROOT_DIR/apps/gateway/dist/cli/index.js" ]]; then
  GATEWAY_START_CMD=(pnpm aihub gateway --dev)
else
  GATEWAY_START_CMD=(pnpm --filter @aihub/gateway exec tsx src/cli/index.ts gateway --dev)
fi

if [[ ! -f "$ROOT_DIR/packages/shared/dist/index.js" ]]; then
  echo "building @aihub/shared"
  (cd "$ROOT_DIR" && pnpm --filter @aihub/shared build >/dev/null)
fi

pick_port() {
  node -e 'const net=require("node:net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const {port}=server.address();console.log(port);server.close();});'
}

report_pass() {
  echo "PASS $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

report_fail() {
  echo "FAIL $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

cleanup() {
  set +e
  if [[ -n "${WEB_PID}" ]]; then kill "${WEB_PID}" 2>/dev/null; fi
  if [[ -n "${GATEWAY_PID}" ]]; then kill "${GATEWAY_PID}" 2>/dev/null; fi
  if [[ -n "${MOCK_PID}" ]]; then kill "${MOCK_PID}" 2>/dev/null; fi
  agent-browser --session "$BROWSER_SESSION" close >/dev/null 2>&1
  wait "${WEB_PID:-}" 2>/dev/null
  wait "${GATEWAY_PID:-}" 2>/dev/null
  wait "${MOCK_PID:-}" 2>/dev/null
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

wait_for_log_port() {
  local log_file=$1
  local pattern=$2
  local timeout_seconds=$3
  local deadline=$((SECONDS + timeout_seconds))
  local value=""

  while (( SECONDS < deadline )); do
    value=$(grep -Eo "$pattern" "$log_file" 2>/dev/null | tail -n 1 | sed -E 's/.*:([0-9]+).*/\1/' || true)
    if [[ -n "$value" ]]; then
      echo "$value"
      return 0
    fi
    sleep 0.2
  done

  return 1
}

wait_for_http_ok() {
  local url=$1
  local timeout_seconds=$2
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  return 1
}

browser_open() {
  agent-browser --session "$BROWSER_SESSION" open "$1" >/dev/null
}

browser_text() {
  agent-browser --session "$BROWSER_SESSION" get text body 2>/dev/null || true
}

wait_for_browser_text() {
  local needle=$1
  local timeout_seconds=$2
  local deadline=$((SECONDS + timeout_seconds))
  local text=""

  while (( SECONDS < deadline )); do
    text=$(browser_text)
    if [[ "$text" == *"$needle"* ]]; then
      return 0
    fi
    sleep 0.5
  done

  return 1
}

wait_for_browser_text_absent() {
  local needle=$1
  local timeout_seconds=$2
  local deadline=$((SECONDS + timeout_seconds))
  local text=""

  while (( SECONDS < deadline )); do
    text=$(browser_text)
    if [[ "$text" != *"$needle"* ]]; then
      return 0
    fi
    sleep 0.5
  done

  return 1
}

take_screenshot() {
  local name=$1
  agent-browser --session "$BROWSER_SESSION" screenshot "$LOG_DIR/$name.png" >/dev/null 2>&1 || true
}

echo "=== PRO-219 Sidebar Verification ==="
echo "workspace: $ROOT_DIR"
echo "tmp: $TMP_DIR"

mkdir -p \
  "$CONFIG_DIR" \
  "$LOG_DIR" \
  "$TMP_DIR/agents/test-agent" \
  "$TMP_DIR/projects" \
  "$TEST_SESSIONS_DIR" \
  "$TEST_SESSION_DIR"

cat >"$TEST_PROJECT_DIR/README.md" <<'EOF'
---
id: PRO-TEST
title: Sidebar Test Project
---

# Sidebar Test Project
EOF
cat >"$TEST_SESSION_DIR/config.json" <<'EOF'
{
  "type": "subagent",
  "cli": "codex",
  "name": "Worker Test"
}
EOF
cat >"$TEST_SESSION_DIR/state.json" <<'EOF'
{
  "supervisor_pid": 0,
  "cli": "codex"
}
EOF
cat >"$TEST_SESSION_DIR/progress.json" <<'EOF'
{
  "last_active": "2026-04-09T00:00:00Z"
}
EOF

GATEWAY_PORT=$(pick_port)
WEB_PORT=$(pick_port)
MOCK_OPENCLAW_PORT=$(pick_port)

cat >"$CONFIG_PATH" <<JSON
{
  "version": 2,
  "gateway": {
    "port": $GATEWAY_PORT,
    "host": "127.0.0.1"
  },
  "ui": {
    "enabled": false,
    "port": $WEB_PORT,
    "bind": "loopback"
  },
  "projects": {
    "root": "$TMP_DIR/projects"
  },
  "components": {
    "projects": {
      "enabled": true
    }
  },
  "agents": [
    {
      "id": "test-agent",
      "name": "Test Agent",
      "workspace": "$TMP_DIR/agents/test-agent",
      "sdk": "openclaw",
      "model": {
        "provider": "openclaw",
        "model": "mock"
      },
      "openclaw": {
        "token": "test-token",
        "gatewayUrl": "ws://127.0.0.1:$MOCK_OPENCLAW_PORT",
        "sessionMode": "fixed"
      }
    }
  ]
}
JSON

(cd "$ROOT_DIR" && MOCK_OPENCLAW_PORT="$MOCK_OPENCLAW_PORT" node <<'NODE'
const { WebSocketServer } = require("ws");

const port = Number(process.env.MOCK_OPENCLAW_PORT);
const wss = new WebSocketServer({ port, host: "127.0.0.1" });
const timers = new Set();

function later(ms, fn) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    fn();
  }, ms);
  timers.add(timer);
}

wss.on("listening", () => {
  console.log(`mock-openclaw listening on 127.0.0.1:${port}`);
});

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== "req") return;

    if (msg.method === "connect") {
      ws.send(JSON.stringify({ type: "res", id: msg.id, ok: true, payload: { type: "hello-ok" } }));
      return;
    }

    if (msg.method === "chat.history") {
      ws.send(JSON.stringify({ type: "res", id: msg.id, ok: true, payload: { items: [] } }));
      return;
    }

    if (msg.method === "chat.send") {
      ws.send(JSON.stringify({ type: "res", id: msg.id, ok: true, payload: { runId: "run-1", status: "started" } }));
      later(1500, () => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(JSON.stringify({
          type: "event",
          event: "chat",
          payload: { state: "delta", message: "Mock", runId: "run-1" }
        }));
      });
      later(3500, () => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(JSON.stringify({
          type: "event",
          event: "chat",
          payload: { state: "final", message: "Mock response", runId: "run-1" }
        }));
      });
    }
  });
});

function shutdown() {
  for (const timer of timers) clearTimeout(timer);
  wss.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
NODE
) >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!

if ! wait_for_log_port "$MOCK_LOG" 'mock-openclaw listening on [^:]+:[0-9]+' 10 >/dev/null; then
  echo "mock-openclaw failed to start"
  cat "$MOCK_LOG"
  exit 1
fi

AIHUB_HOME="$AIHUB_HOME_DIR" DEBUG="aihub:ws" "${GATEWAY_START_CMD[@]}" >"$GATEWAY_LOG" 2>&1 &
GATEWAY_PID=$!

if ! ACTUAL_GATEWAY_PORT=$(wait_for_log_port "$GATEWAY_LOG" 'Starting gateway server on [^:]+:[0-9]+' 20); then
  echo "gateway failed to start"
  cat "$GATEWAY_LOG"
  exit 1
fi

if ! wait_for_http_ok "http://127.0.0.1:$ACTUAL_GATEWAY_PORT/health" 20; then
  echo "gateway health check failed"
  cat "$GATEWAY_LOG"
  exit 1
fi

AIHUB_HOME="$AIHUB_HOME_DIR" pnpm --filter @aihub/web dev >"$WEB_LOG" 2>&1 &
WEB_PID=$!

if ! ACTUAL_WEB_PORT=$(wait_for_log_port "$WEB_LOG" 'http://[^ ]+:[0-9]+' 20); then
  echo "web failed to start"
  cat "$WEB_LOG"
  exit 1
fi

if ! wait_for_http_ok "http://127.0.0.1:$ACTUAL_WEB_PORT" 20; then
  echo "web health check failed"
  cat "$WEB_LOG"
  exit 1
fi

UI_URL="http://127.0.0.1:$ACTUAL_WEB_PORT/projects"
echo "gateway: http://127.0.0.1:$ACTUAL_GATEWAY_PORT"
echo "web: $UI_URL"

browser_open "$UI_URL"
if wait_for_browser_text "ACTIVE PROJECTS" 20 && wait_for_browser_text "No active projects" 10; then
  report_pass "sidebar starts with no active projects"
else
  take_screenshot "step-1-empty"
  report_fail "sidebar starts with no active projects"
fi

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat >"$TEST_SESSION_DIR/state.json" <<EOF
{
  "supervisor_pid": $$,
  "cli": "codex",
  "started_at": "$NOW_ISO"
}
EOF
cat >"$TEST_SESSION_DIR/progress.json" <<EOF
{
  "last_active": "$NOW_ISO"
}
EOF

if wait_for_browser_text "$TEST_PROJECT_LABEL" 10 && wait_for_browser_text "RUNNING" 5; then
  report_pass "ACTIVE PROJECTS shows running project after session appears"
else
  take_screenshot "step-2-running-project"
  report_fail "ACTIVE PROJECTS shows running project after session appears"
fi

cat >"$TEST_SESSION_DIR/state.json" <<'EOF'
{
  "supervisor_pid": 0,
  "cli": "codex"
}
EOF

if wait_for_browser_text_absent "$TEST_PROJECT_LABEL" 10 && wait_for_browser_text "No active projects" 5; then
  report_pass "ACTIVE PROJECTS removes project after session disappears"
else
  take_screenshot "step-3-project-removed"
  report_fail "ACTIVE PROJECTS removes project after session disappears"
fi

EVENTS_JSON="$LOG_DIR/debug-events.json"
curl -fsS "http://127.0.0.1:$ACTUAL_GATEWAY_PORT/api/debug/events" >"$EVENTS_JSON"
if grep -q '"type":"agentChanged"' "$EVENTS_JSON" && grep -q '"projectId":"PRO-TEST"' "$EVENTS_JSON"; then
  report_pass "/api/debug/events returns agent_changed events"
else
  report_fail "/api/debug/events returns agent_changed events"
fi

echo "=== Results ==="
echo "passed: $PASS_COUNT"
echo "failed: $FAIL_COUNT"

if (( FAIL_COUNT > 0 )); then
  echo "logs: $LOG_DIR"
  exit 1
fi
