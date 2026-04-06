"""
Fake cloudifi_admin HTTP service used by Harbor eval tasks.

Implements the subset of the real Cloudi-Fi admin + core APIs that the
`cloudifi_admin` aihub connector actually calls:

- POST /auth/json                           → admin token
- POST /api/2/login/refresh                 → core token
- GET  /companies?disable_company_filter=   → Hydra companies list
- GET  /api/2/reports/subscriptions         → quota report

Both admin and core base URLs are served by the same process in eval mode
(see examples/harbor/base/aihub-eval/aihub.json).

Fixture files live in /fixtures and are mounted/overlaid per task:

    /fixtures/companies.json       → hydra:member list
    /fixtures/quota_report.json    → { report: { ... } }

Captured requests are appended to /tmp/captured_requests.jsonl so verifier
scripts can assert on the agent's outbound call shape.
"""
from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

FIXTURES_DIR = Path(os.environ.get("FAKE_CLOUDIFI_FIXTURES", "/fixtures"))
CAPTURE_PATH = Path(os.environ.get("FAKE_CLOUDIFI_CAPTURE", "/tmp/captured_requests.jsonl"))

app = FastAPI(title="fake-cloudifi-admin")


def _load_fixture(name: str) -> Any:
    path = FIXTURES_DIR / name
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"fixture not found: {name}")
    return json.loads(path.read_text())


def _issue_jwt(exp_seconds_from_now: int = 3600) -> str:
    """
    Issue a syntactically-valid JWT that the aihub connector's TokenManager
    will accept. It decodes the payload base64 and reads `exp`; it does NOT
    verify the signature. We use alg="none" with an empty signature segment.
    """
    header = {"alg": "none", "typ": "JWT"}
    payload = {"exp": int(time.time()) + exp_seconds_from_now, "sub": "eval-user"}

    def _b64(obj: dict[str, Any]) -> str:
        raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    return f"{_b64(header)}.{_b64(payload)}."


async def _capture(request: Request, body: Any = None) -> None:
    try:
        CAPTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with CAPTURE_PATH.open("a") as fh:
            fh.write(
                json.dumps(
                    {
                        "method": request.method,
                        "path": request.url.path,
                        "query": dict(request.query_params),
                        "body": body,
                    }
                )
                + "\n"
            )
    except Exception:
        # Capture is best-effort; never fail a request because of it.
        pass


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/auth/json")
async def auth_json(request: Request) -> dict[str, str]:
    try:
        body = await request.json()
    except Exception:
        body = None
    await _capture(request, body)

    if not isinstance(body, dict) or not body.get("username") or not body.get("password"):
        raise HTTPException(status_code=401, detail="missing credentials")

    return {"token": _issue_jwt()}


@app.post("/api/2/login/refresh")
async def login_refresh(request: Request) -> dict[str, Any]:
    await _capture(request)

    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    return {"tokenid": _issue_jwt(exp_seconds_from_now=3600), "ttl": 3600}


@app.get("/companies")
async def list_companies(request: Request) -> JSONResponse:
    await _capture(request)

    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    companies = _load_fixture("companies.json")
    if isinstance(companies, dict) and "hydra:member" in companies:
        payload = companies
    else:
        # Allow fixtures to be a bare list for convenience
        payload = {
            "hydra:member": companies,
            "hydra:totalItems": len(companies),
        }
    return JSONResponse(payload)


@app.get("/api/2/reports/subscriptions")
async def quota_report(request: Request) -> JSONResponse:
    await _capture(request)

    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    report = _load_fixture("quota_report.json")
    if isinstance(report, dict) and "report" in report:
        payload = report
    else:
        payload = {"report": report}
    return JSONResponse(payload)
