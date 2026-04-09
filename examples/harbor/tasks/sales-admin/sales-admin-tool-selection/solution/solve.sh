#!/bin/bash
# Deterministic oracle for sales-admin-tool-selection.

set -euo pipefail

mkdir -p /logs/agent /app/out

cat <<'EOF' > /logs/agent/result.json
{
  "status": "completed",
  "agent": "sally",
  "finalMessage": "Used quota usage for quarter performance, company listings for renewals, and company details for company 1001.",
  "toolCalls": [
    {
      "id": "call-549f9fcb-1506-4c76-9337-d19670ce2391",
      "name": "cloudifi_admin.get_quota_usage",
      "arguments": {
        "startDate": "2026-01-01",
        "endDate": "2026-03-31"
      },
      "ok": true,
      "result": "Fetched quarterly quota usage.",
      "durationMs": 12
    },
    {
      "id": "call-b99a9ca5-b2f4-483a-9f8d-f788478fdd4d",
      "name": "cloudifi_admin.list_companies",
      "arguments": {},
      "ok": true,
      "result": "Fetched company renewals.",
      "durationMs": 11
    },
    {
      "id": "call-7356def8-b917-4d94-a2ef-fd8c145e1c36",
      "name": "cloudifi_admin.get_company_details",
      "arguments": {
        "companyIds": ["1001"]
      },
      "ok": true,
      "result": "Fetched details for company 1001.",
      "durationMs": 9
    }
  ],
  "metrics": {
    "inputTokens": 0,
    "outputTokens": 0,
    "costUsd": 0
  },
  "artifacts": []
}
EOF
