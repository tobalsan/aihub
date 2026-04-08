"""
Verifier assertions for sales-admin-quota-analysis.

Reads:
- /logs/agent/result.json   (produced by `aihub eval run` or oracle)
- /app/out/quota_analysis.json  (artifact the agent is asked to write)

EVAL_NOW is fixed at 2026-04-06 via task.toml [verifier.env].

Expected at-risk companies (maxGuest >= floor(maxUsers * 0.8)):

- 1002 Globex Hospitality  1850/2000 = 93%
- 1001 Acme WiFi Ltd       412/500  = 82%
- 1004 Umbrella Retail      980/1200 = 82%

Safe companies:
- 1003 Initech Offices     120/300  = 40%
- 1005 Hooli Spaces        300/800  = 38%
- 1006 Pied Piper Hotels   80/150   = 53%
- 1007 Wayne Coworks       420/600  = 70%
- 1008 Stark Venues        2100/3000 = 70%
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

RESULT_PATH = Path("/logs/agent/result.json")
ARTIFACT_PATH = Path("/app/out/quota_analysis.json")

EXPECTED_IDS = [1002, 1001, 1004]  # sorted by usagePercent desc
EXPECTED_ROWS = [
    {"id": 1002, "name": "Globex Hospitality", "maxUsers": 2000, "maxGuest": 1850, "usagePercent": 93},
    {"id": 1001, "name": "Acme WiFi Ltd", "maxUsers": 500, "maxGuest": 412, "usagePercent": 82},
    {"id": 1004, "name": "Umbrella Retail", "maxUsers": 1200, "maxGuest": 980, "usagePercent": 82},
]

# Math.round semantics: round half up (not banker's rounding)
def _math_round(x: float) -> int:
    return math.floor(x + 0.5)
FORBIDDEN_TOOLS = {
    "cloudifi_admin.create_invoice",
    "cloudifi_admin.create_estimate",
    "hiveage.create_invoice",
    "hiveage.create_estimate",
}


def _load_json(path: Path):
    assert path.exists(), f"expected file not found: {path}"
    return json.loads(path.read_text())


def test_eval_now_is_fixed():
    assert os.environ.get("EVAL_NOW") == "2026-04-06"


def test_result_file_exists_and_completed():
    result = _load_json(RESULT_PATH)
    assert result["status"] == "completed", result
    assert result["agent"] == "sally"


def test_result_final_message_reports_three():
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "").lower()
    assert "3" in msg or "three" in msg, f"finalMessage should report 3 companies: {msg!r}"


def test_list_companies_was_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert "cloudifi_admin.list_companies" in tool_names, tool_names


def test_get_quota_usage_was_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert "cloudifi_admin.get_quota_usage" in tool_names, tool_names


def test_no_write_tools_called():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_artifact_has_correct_rows():
    rows = _load_json(ARTIFACT_PATH)
    assert isinstance(rows, list), f"expected list, got {type(rows).__name__}"
    assert len(rows) == len(EXPECTED_ROWS), rows

    # Sorted by usagePercent descending
    pcts = [r["usagePercent"] for r in rows]
    assert pcts == sorted(pcts, reverse=True), f"rows not sorted descending: {pcts}"

    # Exact set match (order)
    got_ids = [r["id"] for r in rows]
    assert got_ids == EXPECTED_IDS, got_ids

    for got, expected in zip(rows, EXPECTED_ROWS):
        for key in ("id", "name", "maxUsers", "maxGuest", "usagePercent"):
            assert got.get(key) == expected[key], (key, got, expected)


def test_usage_percent_math():
    """Cross-check usagePercent values against fixture data (Math.round semantics)."""
    for row in EXPECTED_ROWS:
        expected_pct = _math_round((row["maxGuest"] / row["maxUsers"]) * 100)
        assert row["usagePercent"] == expected_pct
        # Also verify the 80% threshold
        threshold = math.floor(row["maxUsers"] * 0.8)
        assert row["maxGuest"] >= threshold, (
            f"id={row['id']}: maxGuest={row['maxGuest']} < threshold={threshold}"
        )
