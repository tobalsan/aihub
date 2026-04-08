#!/bin/bash
# Deterministic oracle for sales-admin-quota-analysis.
#
# Writes the expected verifier inputs directly. No LLM call.

set -euo pipefail

mkdir -p /logs/agent /app/out

cat <<'EOF' > /logs/agent/result.json
{
  "status": "completed",
  "agent": "sally",
  "finalMessage": "Found 3 companies at or above 80% user quota.",
  "toolCalls": [
    {
      "id": "call-91660553-74e4-4830-b05f-b39b6f1ef70d",
      "name": "cloudifi_admin.list_companies",
      "arguments": {},
      "ok": true,
      "result": "Fetched company user limits.",
      "durationMs": 11
    },
    {
      "id": "call-b26e9d7d-fc46-4591-8e6c-cd267fdd8c16",
      "name": "cloudifi_admin.get_quota_usage",
      "arguments": {},
      "ok": true,
      "result": "Fetched current quota usage report.",
      "durationMs": 17
    }
  ],
  "metrics": {
    "inputTokens": 0,
    "outputTokens": 0,
    "costUsd": 0
  },
  "artifacts": [
    "/app/out/quota_analysis.json"
  ]
}
EOF

cat <<'EOF' > /app/out/quota_analysis.json
[
  {"id": 1002, "name": "Globex Hospitality", "maxUsers": 2000, "maxGuest": 1850, "usagePercent": 93},
  {"id": 1001, "name": "Acme WiFi Ltd", "maxUsers": 500, "maxGuest": 412, "usagePercent": 82},
  {"id": 1004, "name": "Umbrella Retail", "maxUsers": 1200, "maxGuest": 980, "usagePercent": 82}
]
EOF
