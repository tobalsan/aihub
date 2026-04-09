from __future__ import annotations

import json
import os
from pathlib import Path

RESULT_PATH = Path("/logs/agent/result.json")
ARTIFACT_PATH = Path("/app/out/renewal_estimate.json")

EXPECTED_LINE_ITEMS = [
    {
        "type": "base_subscription",
        "description": "Business Pro base subscription",
        "quantity": 1,
        "unitPrice": 299.0,
        "amount": 299.0,
    },
    {
        "type": "user_overage",
        "description": "30 user overage @ 3.50",
        "quantity": 30,
        "unitPrice": 3.5,
        "amount": 105.0,
    },
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


def test_result_final_message():
    result = _load_json(RESULT_PATH)
    msg = result.get("finalMessage", "").lower()
    assert "acme-42" in msg
    assert "404.00" in result.get("finalMessage", "")


def test_required_tools_were_called():
    result = _load_json(RESULT_PATH)
    tool_names = [t["name"] for t in result.get("toolCalls", [])]
    assert "cloudifi_admin.list_companies" in tool_names or "cloudifi_admin.get_company_details" in tool_names
    assert "cloudifi_admin.get_quota_usage" in tool_names


def test_result_artifacts_contains_preview_path():
    result = _load_json(RESULT_PATH)
    assert result.get("artifacts") == ["/app/out/renewal_estimate.json"]


def test_no_write_tools_called():
    result = _load_json(RESULT_PATH)
    tool_names = {t["name"] for t in result.get("toolCalls", [])}
    forbidden_hit = tool_names & FORBIDDEN_TOOLS
    assert not forbidden_hit, f"forbidden tools were called: {forbidden_hit}"


def test_artifact_matches_expected_preview():
    preview = _load_json(ARTIFACT_PATH)
    assert preview == {
        "companyId": 1042,
        "companyName": "ACME-42 Corp",
        "billingDate": "2026-05-01",
        "lineItems": EXPECTED_LINE_ITEMS,
        "total": 404.0,
    }


def test_preview_total_matches_line_items():
    preview = _load_json(ARTIFACT_PATH)
    total = sum(item["amount"] for item in preview["lineItems"])
    assert total == preview["total"]
