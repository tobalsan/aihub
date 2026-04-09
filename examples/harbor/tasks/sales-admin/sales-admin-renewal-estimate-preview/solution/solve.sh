#!/bin/bash
# Deterministic oracle for sales-admin-renewal-estimate-preview.

set -euo pipefail

mkdir -p /logs/agent /app/out

cat <<'EOF' > /logs/agent/result.json
{
  "status": "completed",
  "agent": "sally",
  "finalMessage": "Prepared renewal estimate preview for ACME-42 Corp totaling 404.00.",
  "toolCalls": [
    {
      "id": "call-aa8be6c5-94cf-4a8e-a122-db8134e8337b",
      "name": "cloudifi_admin.list_companies",
      "arguments": {},
      "ok": true,
      "result": "Fetched company pricing records.",
      "durationMs": 10
    },
    {
      "id": "call-9f43c414-1fb8-4c32-951e-3b711d4f18d9",
      "name": "cloudifi_admin.get_quota_usage",
      "arguments": {
        "startDate": "2026-04-01",
        "endDate": "2026-04-06"
      },
      "ok": true,
      "result": "Fetched quota usage for preview.",
      "durationMs": 14
    }
  ],
  "metrics": {
    "inputTokens": 0,
    "outputTokens": 0,
    "costUsd": 0
  },
  "artifacts": [
    "/app/out/renewal_estimate.json"
  ]
}
EOF

cat <<'EOF' > /app/out/renewal_estimate.json
{
  "companyId": 1042,
  "companyName": "ACME-42 Corp",
  "billingDate": "2026-05-01",
  "lineItems": [
    {
      "type": "base_subscription",
      "description": "Business Pro base subscription",
      "quantity": 1,
      "unitPrice": 299.0,
      "amount": 299.0
    },
    {
      "type": "user_overage",
      "description": "30 user overage @ 3.50",
      "quantity": 30,
      "unitPrice": 3.5,
      "amount": 105.0
    }
  ],
  "total": 404.0
}
EOF
