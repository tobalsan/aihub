#!/bin/bash
# Deterministic oracle for sales-admin-renewals.
#
# Writes the expected verifier inputs directly. No LLM call.

set -euo pipefail

mkdir -p /logs/agent /app/out

cat <<'EOF' > /logs/agent/result.json
{
  "status": "completed",
  "agent": "sally",
  "finalMessage": "Found 3 companies with renewals in the next 30 days.",
  "toolCalls": [
    {
      "id": "call-9e2e4fa6-9184-4ef4-b5d5-5a42d939ac40",
      "name": "cloudifi_admin.list_companies",
      "arguments": {},
      "ok": true,
      "result": "Fetched company billing records.",
      "durationMs": 14
    }
  ],
  "metrics": {
    "inputTokens": 0,
    "outputTokens": 0,
    "costUsd": 0
  },
  "artifacts": [
    "/app/out/renewals.json"
  ]
}
EOF

cat <<'EOF' > /app/out/renewals.json
[
  {"id": 1001, "name": "Acme WiFi Ltd", "billingDate": "2026-04-18", "daysUntilRenewal": 12},
  {"id": 1002, "name": "Globex Hospitality", "billingDate": "2026-04-25", "daysUntilRenewal": 19},
  {"id": 1003, "name": "Initech Offices", "billingDate": "2026-05-02", "daysUntilRenewal": 26}
]
EOF
