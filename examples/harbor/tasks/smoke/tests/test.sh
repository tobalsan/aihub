#!/usr/bin/env bash
set -euo pipefail

cd /logs/verifier
exec pytest /app/tests/test_outputs.py -v --tb=short --no-header -o console_output_style=classic 2>&1
