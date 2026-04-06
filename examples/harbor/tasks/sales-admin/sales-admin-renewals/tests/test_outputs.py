"""
Verifier assertions for sales-admin-renewals.

Reads:
- /logs/agent/result.json   (produced by `aihub eval run` or oracle)
- /app/out/renewals.json    (artifact the agent is asked to write)

EVAL_NOW is fixed at 2026-04-06 via task.toml [verifier.env].

Expected renewals within 30 days of 2026-04-06 (inclusive of today,
exclusive of day 31), derived from the base cloudifi-admin fixture:

- 1001 Acme WiFi Ltd       2026-04-18  (+12 days)
- 1002 Globex Hospitality  2026-04-25  (+19 days)
- 1003 Initech Offices     2026-05-02  (+26 days)

Out of window:
- 1004 Umbrella Retail     2026-05-10  (+34 days)
- 1005..1008               later       (too far out)
"""
from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

RESULT_PATH = Path("/logs/agent/result.json")
ARTIFACT_PATH = Path("/app/out/renewals.json")

EXPECTED_IDS = [1001, 1002, 1003]
EXPECTED_ROWS = [
    {"id": 1001, "name": "Acme WiFi Ltd", "billingDate": "2026-04-18", "daysUntilRenewal": 12},
    {"id": 1002, "name": "Globex Hospitality", "billingDate": "2026-04-25", "daysUntilRenewal": 19},
    {"id": 1003, "name": "Initech Offices", "billingDate": "2026-05-02", "daysUntilRenewal": 26},
]
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
    assert result["agent"] == "sales-admin"


def test_result_final_message_reports_three():
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "").lower()
    assert "3" in msg or "three" in msg, f"finalMessage should report 3 companies: {msg!r}"


def test_list_companies_was_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert "cloudifi_admin.list_companies" in tool_names, tool_names


def test_no_write_tools_called():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_artifact_has_correct_rows():
    rows = _load_json(ARTIFACT_PATH)
    assert isinstance(rows, list), f"expected list, got {type(rows).__name__}"
    assert len(rows) == len(EXPECTED_ROWS), rows

    # Sorted by daysUntilRenewal ascending
    days = [r["daysUntilRenewal"] for r in rows]
    assert days == sorted(days), f"rows not sorted ascending: {days}"

    # Exact set match
    got_ids = [r["id"] for r in rows]
    assert got_ids == EXPECTED_IDS, got_ids

    for got, expected in zip(rows, EXPECTED_ROWS):
        for key in ("id", "name", "billingDate", "daysUntilRenewal"):
            assert got.get(key) == expected[key], (key, got, expected)


def test_days_until_renewal_math():
    """Cross-check the daysUntilRenewal values against EVAL_NOW."""
    now = date.fromisoformat(os.environ["EVAL_NOW"])
    for row in EXPECTED_ROWS:
        billing = date.fromisoformat(row["billingDate"])
        assert (billing - now).days == row["daysUntilRenewal"]
