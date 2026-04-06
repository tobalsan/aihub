#!/bin/bash
# Verifier for sales-admin-renewals.
#
# Reads /logs/agent/result.json and /app/out/renewals.json (produced by
# the agent or the oracle solution). Runs pytest assertions and writes
# /logs/verifier/reward.json.
#
# Runs as the non-root `agent` user with no network access. All deps
# (uv-managed pytest on PATH via /opt/uv/bin) are baked into aihub-eval-base.

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
