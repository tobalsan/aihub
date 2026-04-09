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
    {"id": 1008, "name": "Stark Venues", "mrr": 999.0},
    {"id": 1002, "name": "Globex Hospitality", "mrr": 799.0},
    {"id": 1004, "name": "Umbrella Retail", "mrr": 499.0},
    {"id": 1001, "name": "Acme WiFi Ltd", "mrr": 299.0},
    {"id": 1007, "name": "Wayne Coworks", "mrr": 249.0},
    {"id": 1005, "name": "Hooli Spaces", "mrr": 199.0},
    {"id": 1003, "name": "Initech Offices", "mrr": 149.0},
    {"id": 1006, "name": "Pied Piper Hotels", "mrr": 99.0},
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
    assert result["agent"] == "sally"


def test_list_companies_was_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert "cloudifi_admin.list_companies" in tool_names, tool_names


def test_no_write_tools_called():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_artifact_schema_and_totals():
    report = _load_json(ARTIFACT_PATH)
    assert set(report) == {"arr", "mrr", "by_company"}
    assert isinstance(report["by_company"], list)
    assert math.isclose(report["mrr"], EXPECTED_MRR, rel_tol=0.0, abs_tol=1e-9)
    assert math.isclose(report["arr"], EXPECTED_ARR, rel_tol=0.0, abs_tol=1e-9)


def test_by_company_sorted_and_exact():
    report = _load_json(ARTIFACT_PATH)
    by_company = report["by_company"]
    assert by_company == EXPECTED_BY_COMPANY
    values = [row["mrr"] for row in by_company]
    assert values == sorted(values, reverse=True)


def test_arr_matches_mrr_times_twelve():
    report = _load_json(ARTIFACT_PATH)
    assert math.isclose(report["arr"], report["mrr"] * 12, rel_tol=0.0, abs_tol=1e-9)
