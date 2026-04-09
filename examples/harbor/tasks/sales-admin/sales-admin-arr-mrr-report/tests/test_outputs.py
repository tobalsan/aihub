from __future__ import annotations

import json
import math
import os
from pathlib import Path

RESULT_PATH = Path("/logs/agent/result.json")
ARTIFACT_PATH = Path("/app/out/arr-mrr.json")

EXPECTED_MRR = 3292.0
EXPECTED_ARR = 39504.0
EXPECTED_BY_COMPANY = [
    {"id": 1008, "mrr": 999.0},
    {"id": 1002, "mrr": 799.0},
    {"id": 1004, "mrr": 499.0},
    {"id": 1001, "mrr": 299.0},
    {"id": 1007, "mrr": 249.0},
    {"id": 1005, "mrr": 199.0},
    {"id": 1003, "mrr": 149.0},
    {"id": 1006, "mrr": 99.0},
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


def _get_report():
    """Load report from file if it exists, else try parsing from finalMessage."""
    if ARTIFACT_PATH.exists():
        return _load_json(ARTIFACT_PATH)
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "")
    import re
    m = re.search(r"\{[\s\S]*\"by_company\"[\s\S]*\}", msg)
    if m:
        return json.loads(m.group())
    raise AssertionError(f"report not found at {ARTIFACT_PATH} and no JSON in finalMessage")


def test_eval_now_is_fixed():
    assert os.environ.get("EVAL_NOW") == "2026-04-06"


def test_result_file_exists_and_completed():
    result = _load_json(RESULT_PATH)
    assert result["status"] == "completed", result
    assert result["agent"] == "sally"


def test_result_final_message():
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "")
    assert "39504" in msg or "39,504" in msg
    assert "3292" in msg or "3,292" in msg


def test_list_companies_was_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert "cloudifi_admin.list_companies" in tool_names, tool_names


def test_no_write_tools_called():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_report_schema_and_totals():
    report = _get_report()
    assert "arr" in report
    assert "mrr" in report
    assert "by_company" in report
    assert math.isclose(report["mrr"], EXPECTED_MRR, rel_tol=0.01)
    assert math.isclose(report["arr"], EXPECTED_ARR, rel_tol=0.01)


def test_by_company_has_correct_ids_in_order():
    report = _get_report()
    by_company = report["by_company"]
    actual_ids = [row["id"] for row in by_company]
    expected_ids = [row["id"] for row in EXPECTED_BY_COMPANY]
    assert actual_ids == expected_ids, f"company order mismatch: {actual_ids} != {expected_ids}"


def test_by_company_mrr_values_correct():
    report = _get_report()
    by_company = report["by_company"]
    actual_mrrs = {row["id"]: row["mrr"] for row in by_company}
    expected_mrrs = {row["id"]: row["mrr"] for row in EXPECTED_BY_COMPANY}
    for cid in expected_mrrs:
        assert math.isclose(actual_mrrs[cid], expected_mrrs[cid], rel_tol=0.01), \
            f"company {cid}: {actual_mrrs[cid]} != {expected_mrrs[cid]}"


def test_arr_matches_mrr_times_twelve():
    report = _get_report()
    assert math.isclose(report["arr"], report["mrr"] * 12, rel_tol=0.01)
