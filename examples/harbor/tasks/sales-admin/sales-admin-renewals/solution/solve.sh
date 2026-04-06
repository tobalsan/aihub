#!/bin/bash
# Oracle solution for sales-admin-renewals.
#
# This does NOT run aihub — it writes the expected result.json + artifact
# directly so we can validate the verifier before the real `aihub eval run`
# CLI exists. Once the CLI lands, replace this with:
#
#   aihub eval run \
#     --agent sales-admin \
#     --instruction-file /app/instruction.md \
#     --output /logs/agent/result.json \
#     --trace /logs/agent/trajectory.json
#
# For now we just produce a known-good output.

set -euo pipefail

mkdir -p /logs/agent /app/out

cat > /app/out/renewals.json <<'JSON'
[
  {
    "id": 1001,
    "name": "Acme WiFi Ltd",
    "billingDate": "2026-04-18",
    "daysUntilRenewal": 12
  },
  {
    "id": 1002,
    "name": "Globex Hospitality",
    "billingDate": "2026-04-25",
    "daysUntilRenewal": 19
  },
  {
    "id": 1003,
    "name": "Initech Offices",
    "billingDate": "2026-05-02",
    "daysUntilRenewal": 26
  }
]
JSON

cat > /logs/agent/result.json <<'JSON'
{
  "status": "completed",
  "agent": "sales-admin",
  "model": "oracle",
  "finalMessage": "Found 3 companies with renewals in the next 30 days.",
  "toolCalls": [
    {
      "name": "cloudifi_admin.list_companies",
      "arguments": { "extraFields": false },
      "ok": true,
      "durationMs": 0
    }
  ],
  "metrics": {
    "durationMs": 0,
    "inputTokens": 0,
    "outputTokens": 0,
    "costUsd": 0
  },
  "artifacts": [
    { "path": "/app/out/renewals.json", "type": "file" }
  ]
}
JSON
