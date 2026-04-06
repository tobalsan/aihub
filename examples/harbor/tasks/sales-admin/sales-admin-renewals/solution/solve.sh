#!/bin/bash
# Real solution for sales-admin-renewals.
#
# Calls `aihub eval run` with the Sally agent against the task
# instruction. The CLI is baked into aihub-eval-base; the Sally agent +
# requesty provider + cloudifi-admin connector are vendored at /eval.
#
# Sally must:
#   1. Call cloudifi_admin.list_companies
#   2. Filter to billingDate within 30 days of EVAL_NOW (2026-04-06)
#   3. Write /app/out/renewals.json sorted ascending by daysUntilRenewal
#   4. Reply "Found N companies with renewals in the next 30 days."

set -euo pipefail

mkdir -p /logs/agent /app/out

aihub eval run \
  --agent sally \
  --instruction-file /solution/instruction.md \
  --output /logs/agent/result.json \
  --trace /logs/agent/trajectory.json
