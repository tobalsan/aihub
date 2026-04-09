#!/bin/bash
# Deterministic oracle for sales-admin-arr-mrr-report.

set -euo pipefail

mkdir -p /logs/agent /app/out

cat <<'EOF' > /logs/agent/result.json
{
  "status": "completed",
  "agent": "sally",
  "finalMessage": "Saved the ARR/MRR report for 2026-Q1 to /app/out/arr-mrr.json with MRR 3292.00 and ARR 39504.00.",
  "toolCalls": [
    {
      "id": "call-2057f748-1a07-4940-b513-99b59a1c0f45",
      "name": "cloudifi_admin.list_companies",
      "arguments": {},
      "ok": true,
      "result": "Fetched company billing rates.",
      "durationMs": 13
    }
  ],
  "metrics": {
    "inputTokens": 0,
    "outputTokens": 0,
    "costUsd": 0
  },
  "artifacts": [
    "/app/out/arr-mrr.json"
  ]
}
EOF

cat <<'EOF' > /app/out/arr-mrr.json
{
  "arr": 39504.0,
  "mrr": 3292.0,
  "by_company": [
    { "id": 1008, "name": "Stark Venues", "mrr": 999.0 },
    { "id": 1002, "name": "Globex Hospitality", "mrr": 799.0 },
    { "id": 1004, "name": "Umbrella Retail", "mrr": 499.0 },
    { "id": 1001, "name": "Acme WiFi Ltd", "mrr": 299.0 },
    { "id": 1007, "name": "Wayne Coworks", "mrr": 249.0 },
    { "id": 1005, "name": "Hooli Spaces", "mrr": 199.0 },
    { "id": 1003, "name": "Initech Offices", "mrr": 149.0 },
    { "id": 1006, "name": "Pied Piper Hotels", "mrr": 99.0 }
  ]
}
EOF
