from __future__ import annotations

import json
import os
from pathlib import Path

RESULT_PATH = Path("/logs/agent/result.json")
FORBIDDEN_TOOLS = {
    "cloudifi_admin.create_invoice",
    "cloudifi_admin.create_estimate",
    "hiveage.create_invoice",
    "hiveage.create_estimate",
}
EXPECTED_SEQUENCE = [
    "cloudifi_admin.get_quota_usage",
    "cloudifi_admin.list_companies",
    "cloudifi_admin.get_company_details",
]


def _load_json(path: Path):
    assert path.exists(), f"expected file not found: {path}"
    return json.loads(path.read_text())


def test_eval_now_is_fixed():
    assert os.environ.get("EVAL_NOW") == "2026-04-06"


def test_result_file_exists_and_completed():
    result = _load_json(RESULT_PATH)
    assert result["status"] == "completed", result
    assert result["agent"] == "sally"


def test_expected_tools_were_selected_in_order():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert tool_names == EXPECTED_SEQUENCE


def test_forbidden_tools_absent():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_company_details_targets_company_1001():
    result = _load_json(RESULT_PATH)
    details_call = result["toolCalls"][2]
    assert details_call["arguments"] == {"companyIds": ["1001"]}
