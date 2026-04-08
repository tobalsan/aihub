#!/bin/bash
# Real solution for sales-admin-quota-analysis.
#
# Sally must:
#   1. Call cloudifi_admin.list_companies to get user limits
#   2. Call cloudifi_admin.get_quota_usage to get current usage
#   3. Join + filter for >= 80% user quota
#   4. Write /app/out/quota_analysis.json sorted descending by usagePercent
#   5. Reply "Found N compan(ies) at or above 80% user quota."

set -euo pipefail

mkdir -p /logs/agent /app/out

aihub eval run \
  --agent sally \
  --instruction-file /solution/instruction.md \
  --output /logs/agent/result.json \
  --trace /logs/agent/trajectory.json
