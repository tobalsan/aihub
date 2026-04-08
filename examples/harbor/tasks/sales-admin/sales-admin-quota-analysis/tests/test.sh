#!/bin/bash
# Verifier for sales-admin-quota-analysis.
#
# Reads /logs/agent/result.json and /app/out/quota_analysis.json (produced by
# the agent or the oracle solution). Runs pytest assertions and writes
# /logs/verifier/reward.json.

set -euo pipefail

mkdir -p /logs/verifier

set +e
pytest /tests/test_outputs.py -q
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  printf '{"pass_rate": 1.0}' > /logs/verifier/reward.json
else
  printf '{"pass_rate": 0.0}' > /logs/verifier/reward.json
fi

exit "$rc"
