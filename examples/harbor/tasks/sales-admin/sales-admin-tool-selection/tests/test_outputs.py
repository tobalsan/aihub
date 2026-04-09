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
REQUIRED_TOOLS = [
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


def test_result_final_message():
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "").lower()
    # Agent should reference quota, renewals/companies, and a company detail
    assert "quota" in msg or "usage" in msg or "quarter" in msg
    assert "renewal" in msg or "compan" in msg or "list" in msg
    assert "1001" in msg or "acme" in msg or "detail" in msg


def test_required_tools_were_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    for required in REQUIRED_TOOLS:
        assert required in tool_names, f"missing required tool: {required}. Got: {tool_names}"


def test_required_tools_called_in_order():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    # Strip non-required tools, then check order is preserved
    filtered = [t for t in tool_names if t in REQUIRED_TOOLS]
    # Check the first occurrence of each required tool respects the order
    indices = {tool: filtered.index(tool) for tool in REQUIRED_TOOLS if tool in filtered}
    assert indices["cloudifi_admin.get_quota_usage"] < indices["cloudifi_admin.list_companies"]
    assert indices["cloudifi_admin.list_companies"] < indices["cloudifi_admin.get_company_details"]


def test_forbidden_tools_absent():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_company_details_targets_company_1001():
    result = _load_json(RESULT_PATH)
    details_calls = [t for t in result.get("toolCalls", []) if t["name"] == "cloudifi_admin.get_company_details"]
    assert len(details_calls) >= 1, "no get_company_details call found"
    args = details_calls[0].get("arguments", {})
    raw = str(args.get("companyIds", ""))
    assert "1001" in raw, f"company_ids should reference 1001, got: {args}"
