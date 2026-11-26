"""Phase 5A.1 'manuscript_draft' job handler for the research worker.

Input: a queue message pointing at a frozen project snapshot in R2 (the
ResearchMD manifest: protocol, verified evidence, RoB, GRADE, saved runs,
references). Output: result.json carrying a draft manuscript JSON whose
numbers are STILL canonical {{run:<runId>.<fieldPath>}} tokens (unresolved).
Rendering to values happens only at preview/export (5A.2/5A.3), never here.

Every LLM call goes through the gateway client (po_adapter.llm.GatewayLLMClient)
with a per-job bearer token minted locally from RESEARCH_CALLBACK_SECRET
(gateway.md). No provider key is read, held or forwarded. The PHI gate and the
tier ceilings run inside the client before any request leaves the worker.

Registration: research_worker.jobs.handler_for routes kind 'manuscript_draft'
to validate_message/run_job here; the container image ships manuscript/,
stats/ and paperorchestra/ (worker/Dockerfile).

Message shape (input pointers, no content, no PHI):
    {v: 1, kind: "manuscript_draft", jobId, projectId, idempotencyKey, createdAt,
     input: {r2Key: "projects/<pid>/manuscript/snapshots/<snapshotId>.json",
             cutoffDate?: "YYYY-MM"},
     ceilings: {maxSeconds: 1..600, maxCalls: 1..64}}

run_job mirrors research_worker.jobs.run_job ({status, settled, skipped, error})
and reuses its HMAC callback and idempotency/cancel key layout. A hard-gate
failure persists the violation list to result.json (audit) and fails the job
with code gate_failed; partial drafts are never returned as a result.

Stable error codes: input_missing, snapshot_invalid, gate_failed, phi_blocked,
gateway_unconfigured, the loader codes (unverified_value, missing_provenance,
protocol_unlocked, unverified_rob, invalid_grade, invalid_run, ...), the
ceiling codes (ceiling_input_tokens, ceiling_output_tokens, ceiling_calls,
ceiling_refinement_rounds, ceiling_seconds), gateway_* and manuscript_failed.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import tempfile
import time

log = logging.getLogger("research_manuscript.job")

KIND = "manuscript_draft"
GLOBAL_MAX_SECONDS = 600
GLOBAL_MAX_CALLS = 64
R2_KEY_RE = re.compile(
    r"^projects/[A-Za-z0-9_-]+/manuscript/snapshots/[A-Za-z0-9_.-]+\.json$")
_CODE_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def mint_job_token(secret: str, job_id: str, expires_at: int) -> str:
    """Per-job gateway bearer token, exactly gateway.md's mintJobToken:
    "<jobId>.<expiresAt>.<hex HMAC-SHA256(secret, 'llm:'+jobId+':'+expiresAt)>".
    The worker holds the callback secret, never a provider key."""
    message = ("llm:" + job_id + ":" + str(expires_at)).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"{job_id}.{expires_at}.{digest}"


def validate_message(msg) -> None:
    """Raise ValueError when a manuscript_draft message is malformed."""
    if not isinstance(msg, dict):
        raise ValueError("message must be an object")
    if msg.get("v") != 1:
        raise ValueError("unsupported message version")
    if msg.get("kind") != KIND:
        raise ValueError("unsupported kind")
    for field in ("jobId", "projectId", "idempotencyKey"):
        value = msg.get(field)
        if not isinstance(value, str) or not value or len(value) > 120:
            raise ValueError(f"bad {field}")
    created = msg.get("createdAt")
    if not isinstance(created, int) or isinstance(created, bool) or created < 0:
        raise ValueError("bad createdAt")
    ceilings = msg.get("ceilings")
    if not isinstance(ceilings, dict):
        raise ValueError("bad ceilings")
    for field, limit in (("maxSeconds", GLOBAL_MAX_SECONDS), ("maxCalls", GLOBAL_MAX_CALLS)):
        value = ceilings.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= limit:
            raise ValueError(f"bad ceilings.{field}")
    inp = msg.get("input")
    if not isinstance(inp, dict):
        raise ValueError("bad input")
    r2_key = inp.get("r2Key")
    if not isinstance(r2_key, str) or not R2_KEY_RE.match(r2_key):
        raise ValueError("bad input.r2Key")
    if not r2_key.startswith(f"projects/{msg['projectId']}/"):
        raise ValueError("input.r2Key outside message project")
    cutoff = inp.get("cutoffDate")
    if cutoff is not None and (not isinstance(cutoff, str)
                               or not re.match(r"^\d{4}-\d{2}$", cutoff)):
        raise ValueError("bad input.cutoffDate")


def run_job(
    msg: dict,
    *,
    storage,
    callback_client,
    callback_url: str,
    secret: str,
    sleep=time.sleep,
    now=time.time,
    monotonic=time.monotonic,
    llm_client=None,
    workdir=None,
    search=None,
) -> dict:
    """Run one validated manuscript_draft message; same contract as the
    worker's run_job. Returns {status, settled, skipped, error}. llm_client and
    workdir are test seams (the worker builds them from env / a temp dir)."""
    from research_worker.jobs import cancel_key_for, result_key_for, send_callback
    from paperorchestra.adapter.po_adapter import gates, loader, pipeline
    from paperorchestra.adapter.po_adapter.llm import (
        CeilingError, GatewayError, GatewayLLMClient)
    from paperorchestra.adapter.po_adapter.phi import PhiBlockedError

    job_id = msg["jobId"]
    idempotency_key = msg["idempotencyKey"]
    result_key = result_key_for(msg)
    cancel_key = cancel_key_for(msg)

    def callback(status, usage, result=None, error=None):
        payload = {"jobId": job_id, "idempotencyKey": idempotency_key,
                   "status": status, "usage": usage}
        if status == "done":
            payload["resultKey"] = result
        if status == "failed":
            payload["error"] = error
        return send_callback(callback_client, callback_url, job_id, payload, secret,
                             sleep=sleep, now=now)

    existing = storage.get_bytes(result_key)
    if existing is not None:
        stored = json.loads(existing)
        status = stored.get("status", "done")
        ok = callback(
            status, stored.get("usage", {"pages": 0, "seconds": 0}),
            result=result_key if status == "done" else None, error=stored.get("error"),
        )
        return {"status": status, "settled": ok, "skipped": True, "error": stored.get("error")}

    if storage.exists(cancel_key):
        ok = callback("cancelled", {"pages": 0, "seconds": 0})
        return {"status": "cancelled", "settled": ok, "skipped": False, "error": None}

    data = storage.get_bytes(msg["input"]["r2Key"])
    if data is None:
        ok = callback("failed", {"pages": 0, "seconds": 0}, error="input_missing")
        return {"status": "failed", "settled": ok, "skipped": False, "error": "input_missing"}

    start = monotonic()

    def usage():
        return {"pages": 0, "seconds": round(monotonic() - start, 1)}

    def fail(code, violations=None):
        u = usage()
        if violations is not None:
            # Persist the failure list for audit/UI; redelivery replays it.
            record = {"jobId": job_id, "idempotencyKey": idempotency_key,
                      "status": "failed", "error": code, "usage": u,
                      "violations": violations}
            storage.put_bytes(result_key, json.dumps(record, separators=(",", ":")).encode("utf-8"))
        ok = callback("failed", u, error=code)
        return {"status": "failed", "settled": ok, "skipped": False, "error": code}

    try:
        manifest = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return fail("snapshot_invalid")
    if not isinstance(manifest, dict):
        return fail("snapshot_invalid")

    try:
        loader.validate_manifest(manifest)
    except loader.LoaderError as exc:
        return fail(exc.code)

    if llm_client is None:
        gateway_url = os.environ.get("RESEARCH_GATEWAY_URL", "")
        if not gateway_url:
            return fail("gateway_unconfigured")
        # Fresh token per gateway call (the gateway rejects tokens older than 900 s);
        # 840 s leaves room for clock skew between the container and Cloudflare.
        llm_client = GatewayLLMClient(
            gateway_url=gateway_url,
            job_token=lambda: mint_job_token(secret, job_id, int(now()) + 840),
            job_id=job_id, project_id=msg["projectId"],
            user_id=msg.get("userId", ""), tier="T2",
            max_calls=min(msg["ceilings"]["maxCalls"], GLOBAL_MAX_CALLS),
            sleep=sleep, now=now,
        )

    owns_workdir = workdir is None
    tmp = tempfile.TemporaryDirectory(prefix="researchmd_draft_") if owns_workdir else None
    run_dir = workdir if workdir is not None else tmp.name
    try:
        manuscript = pipeline.run_manuscript(
            manifest, run_dir, llm_client, search=search,
            cutoff_date=msg["input"].get("cutoffDate"), with_literature=False,
            max_reflections=llm_client.ceilings["max_refinement_rounds"],
        )
    except gates.GateError as exc:
        log.warning("manuscript job %s blocked by gates: %s", job_id,
                    sorted({v["gate"] for v in exc.violations}))
        return fail("gate_failed", violations=exc.violations)
    except PhiBlockedError:
        return fail("phi_blocked")
    except (CeilingError, GatewayError) as exc:
        return fail(exc.code)
    except loader.LoaderError as exc:
        return fail(exc.code)
    except ValueError as exc:
        code = str(exc)
        return fail(code if _CODE_RE.match(code) else "manuscript_failed")
    except Exception:
        log.exception("manuscript draft crashed for job %s", job_id)
        return fail("manuscript_failed")
    finally:
        if owns_workdir:
            tmp.cleanup()

    if monotonic() - start > min(msg["ceilings"]["maxSeconds"], GLOBAL_MAX_SECONDS):
        return fail("ceiling_seconds")

    total = llm_client.total_usage()
    stored = {
        "jobId": job_id, "idempotencyKey": idempotency_key, "status": "done",
        "usage": usage(),
        "aiUsage": {"calls": total["calls"], "inputTokens": total["inputTokens"],
                    "outputTokens": total["outputTokens"], "records": llm_client.usage},
        "draft": manuscript,
    }
    storage.put_bytes(result_key, json.dumps(stored, separators=(",", ":"),
                                             allow_nan=False).encode("utf-8"))
    ok = callback("done", stored["usage"], result=result_key)
    return {"status": "done", "settled": ok, "skipped": False, "error": None}
