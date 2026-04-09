from __future__ import annotations

import json
import os
from pathlib import Path

RESULT_PATH = Path("/logs/agent/result.json")
ARTIFACT_PATH = Path("/app/out/renewal_estimate.json")

FORBIDDEN_TOOLS = {
    "cloudifi_admin.create_invoice",
    "cloudifi_admin.create_estimate",
    "hiveage.create_invoice",
    "hiveage.create_estimate",
}


def _load_json(path: Path):
    assert path.exists(), f"expected file not found: {path}"
    return json.loads(path.read_text())


def _get_artifact():
    """Load artifact from file if it exists, else try parsing from finalMessage."""
    if ARTIFACT_PATH.exists():
        return _load_json(ARTIFACT_PATH)
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "")
    # Try to extract JSON block from the message
    import re
    m = re.search(r"\{[\s\S]*\"lineItems\"[\s\S]*\}", msg)
    if m:
        return json.loads(m.group())
    raise AssertionError(f"artifact not found at {ARTIFACT_PATH} and no JSON in finalMessage")


def test_eval_now_is_fixed():
    assert os.environ.get("EVAL_NOW") == "2026-04-06"


def test_result_file_exists_and_completed():
    result = _load_json(RESULT_PATH)
    assert result["status"] == "completed", result
    assert result["agent"] == "sally"


def test_result_final_message():
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "").lower()
    assert "acme-42" in msg or "acme 42" in msg
    assert "404" in result.get("finalMessage", "")


def test_required_tools_were_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert "cloudifi_admin.list_companies" in tool_names or "cloudifi_admin.get_company_details" in tool_names
    assert "cloudifi_admin.get_quota_usage" in tool_names


def test_no_write_tools_called():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_artifact_has_correct_company_and_total():
    preview = _get_artifact()
    assert preview["companyId"] == 1042
    assert preview["companyName"].lower().startswith("acme")
    assert preview["total"] == 404.0


def test_artifact_has_two_line_items_with_correct_amounts():
    preview = _get_artifact()
    items = preview["lineItems"]
    amounts = [item["amount"] for item in items]
    assert 299.0 in amounts, f"missing base subscription (299.0) in {amounts}"
    assert 105.0 in amounts, f"missing overage (105.0) in {amounts}"


def test_preview_total_matches_line_items():
    preview = _get_artifact()
    total = sum(item["amount"] for item in preview["lineItems"])
    assert total == preview["total"]
