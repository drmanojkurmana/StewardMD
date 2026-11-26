"""Idempotent job execution, cancel checks and the HMAC callback.

Contract: docs/research/contracts/phase-3/callback.md and job-message.schema.json.
The worker holds no user tokens. Callbacks carry codes and pointers only.
"""
from __future__ import annotations

import hmac
import json
import logging
import re
import time

import httpx

from .extract import CancelledError, CeilingError, ExtractError, extract_pdf
from .storage import StorageError

log = logging.getLogger("research_worker.jobs")

R2_KEY_RE = re.compile(r"^projects/[A-Za-z0-9_-]+/pdf/[0-9a-f]{64}\.pdf$")
GLOBAL_MAX_PAGES = 60
GLOBAL_MAX_SECONDS = 240
CALLBACK_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 60


def sign_callback(secret: str, timestamp: str, raw_body: bytes) -> str:
    """hex HMAC-SHA256(secret, timestamp + "." + rawBody), per callback.md."""
    message = timestamp.encode("utf-8") + b"." + raw_body
    return hmac.new(secret.encode("utf-8"), message, "sha256").hexdigest()


def validate_message(msg) -> None:
    """Raise ValueError when the message fails job-message.schema.json."""
    if not isinstance(msg, dict):
        raise ValueError("message must be an object")
    if msg.get("v") != 1:
        raise ValueError("unsupported message version")
    if msg.get("kind") != "pdf_extract":
        raise ValueError("unsupported kind")
    for field in ("jobId", "projectId", "idempotencyKey"):
        value = msg.get(field)
        if not isinstance(value, str) or not value or len(value) > 120:
            raise ValueError(f"bad {field}")
    created = msg.get("createdAt")
    if not isinstance(created, int) or created < 0:
        raise ValueError("bad createdAt")
    ceilings = msg.get("ceilings")
    if not isinstance(ceilings, dict):
        raise ValueError("bad ceilings")
    for field, limit in (("maxPages", GLOBAL_MAX_PAGES), ("maxSeconds", GLOBAL_MAX_SECONDS)):
        value = ceilings.get(field)
        if not isinstance(value, int) or not 1 <= value <= limit:
            raise ValueError(f"bad ceilings.{field}")
    r2_key = (msg.get("input") or {}).get("r2Key")
    if not isinstance(r2_key, str) or not R2_KEY_RE.match(r2_key):
        raise ValueError("bad input.r2Key")
    if not r2_key.startswith(f"projects/{msg['projectId']}/"):
        raise ValueError("input.r2Key outside message project")


def result_key_for(msg: dict) -> str:
    return f"projects/{msg['projectId']}/jobs/{msg['jobId']}/result.json"


def cancel_key_for(msg: dict) -> str:
    return f"projects/{msg['projectId']}/jobs/{msg['jobId']}/cancel"


def _callback_payload(job_id, idempotency_key, status, usage, result_key=None, error=None) -> dict:
    payload = {"jobId": job_id, "idempotencyKey": idempotency_key, "status": status, "usage": usage}
    if status == "done":
        payload["resultKey"] = result_key
    if status == "failed":
        payload["error"] = error
    return payload


def send_callback(
    client: httpx.Client,
    base_url: str,
    job_id: str,
    payload: dict,
    secret: str,
    *,
    sleep=time.sleep,
    now=time.time,
) -> bool:
    """POST the signed callback. True on any 2xx within 3 attempts."""
    raw_body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    url = f"{base_url.rstrip('/')}/api/research/jobs/{job_id}/callback"
    for attempt in range(CALLBACK_ATTEMPTS):
        timestamp = str(int(now()))
        signature = sign_callback(secret, timestamp, raw_body)
        try:
            resp = client.post(
                url,
                content=raw_body,
                headers={
                    "Content-Type": "application/json",
                    "X-Research-Timestamp": timestamp,
                    "X-Research-Signature": signature,
                },
                timeout=10.0,
            )
            if 200 <= resp.status_code < 300:
                return True
            log.warning("callback for %s returned HTTP %s", job_id, resp.status_code)
        except httpx.HTTPError:
            log.warning("callback transport error for %s", job_id)
        if attempt < CALLBACK_ATTEMPTS - 1:
            sleep(2**attempt)
    return False


def run_job(
    msg: dict,
    *,
    storage,
    callback_client: httpx.Client,
    callback_url: str,
    secret: str,
    sleep=time.sleep,
    now=time.time,
    monotonic=time.monotonic,
) -> dict:
    """Run one validated message. Returns {status, settled, skipped, error}.

    settled means the callback returned 2xx; only then may the caller ack.
    Storage infrastructure errors propagate so the message stays un-acked.
    """
    job_id = msg["jobId"]
    idempotency_key = msg["idempotencyKey"]
    result_key = result_key_for(msg)
    cancel_key = cancel_key_for(msg)

    def callback(status, usage, result=None, error=None):
        payload = _callback_payload(job_id, idempotency_key, status, usage, result, error)
        return send_callback(
            callback_client, callback_url, job_id, payload, secret, sleep=sleep, now=now
        )

    existing = storage.get_bytes(result_key)
    if existing is not None:
        stored = json.loads(existing)
        status = stored.get("status", "done")
        ok = callback(
            status,
            stored.get("usage", {"pages": 0, "seconds": 0}),
            result=result_key if status == "done" else None,
            error=stored.get("error"),
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
    pages_done = 0

    def on_page(n):
        nonlocal pages_done
        pages_done = n

    def cancel_check():
        if storage.exists(cancel_key):
            raise CancelledError()

    def usage():
        return {"pages": pages_done, "seconds": round(monotonic() - start, 1)}

    try:
        result = extract_pdf(
            data,
            max_pages=min(msg["ceilings"]["maxPages"], GLOBAL_MAX_PAGES),
            max_seconds=min(msg["ceilings"]["maxSeconds"], GLOBAL_MAX_SECONDS),
            cancel_check=cancel_check,
            on_page=on_page,
        )
    except CancelledError:
        ok = callback("cancelled", usage())
        return {"status": "cancelled", "settled": ok, "skipped": False, "error": None}
    except (CeilingError, ExtractError) as exc:
        ok = callback("failed", usage(), error=exc.code)
        return {"status": "failed", "settled": ok, "skipped": False, "error": exc.code}
    except Exception:
        log.exception("extraction crashed for job %s", job_id)
        ok = callback("failed", usage(), error="extract_failed")
        return {"status": "failed", "settled": ok, "skipped": False, "error": "extract_failed"}

    final_usage = {"pages": len(result["pages"]), "seconds": round(monotonic() - start, 1)}
    stored = dict(result)
    stored.update(
        {"jobId": job_id, "idempotencyKey": idempotency_key, "status": "done", "usage": final_usage}
    )
    storage.put_bytes(result_key, json.dumps(stored, separators=(",", ":")).encode("utf-8"))
    ok = callback("done", final_usage, result=result_key)
    return {"status": "done", "settled": ok, "skipped": False, "error": None}


def handler_for(kind):
    """Resolve (validate_message, run_job) for a job kind, or None for an
    unknown kind (the message retries to the DLQ). Handler modules are imported
    lazily so the pdf_extract worker never pays for the stats/manuscript deps
    unless that kind is actually delivered. Each handler owns its own message
    validation and ceilings (stats/job.py, manuscript/job.py)."""
    if kind == "pdf_extract":
        return validate_message, run_job
    if kind == "stats_model":
        from stats import job as stats_job
        return stats_job.validate_message, stats_job.run_job
    if kind == "manuscript_draft":
        from manuscript import job as manuscript_job
        return manuscript_job.validate_message, manuscript_job.run_job
    return None


def drain_once(
    queue,
    storage,
    *,
    callback_client: httpx.Client,
    callback_url: str,
    secret: str,
    batch_size: int = 5,
    # 2 h lease: a manuscript_draft (up to 64 gateway calls) can outrun 15 min, and /drain runs every
    # minute, so a shorter lease let a second drain pick up the same job and pay for it twice.
    visibility_timeout_ms: int = 7_200_000,
    sleep=time.sleep,
) -> dict:
    """Pull up to batch_size messages and settle each one.

    Ack only after the result is durable (when done) AND the callback
    returned 2xx. Anything else is retried with a delay or left for the
    visibility timeout; after 3 deliveries the queue dead-letters it.
    """
    messages = queue.pull(batch_size=batch_size, visibility_timeout_ms=visibility_timeout_ms)
    counts = {"pulled": len(messages), "done": 0, "failed": 0, "cancelled": 0, "retried": 0}
    for message in messages:
        if message.body is None:
            log.warning("malformed message %s; retrying to DLQ", message.id)
            queue.retry(message.lease_id, delay_seconds=RETRY_DELAY_SECONDS)
            counts["retried"] += 1
            continue
        handler = handler_for(message.body.get("kind"))
        if handler is None:
            log.warning("unknown kind %r in %s; retrying to DLQ",
                        message.body.get("kind"), message.id)
            queue.retry(message.lease_id, delay_seconds=RETRY_DELAY_SECONDS)
            counts["retried"] += 1
            continue
        validate, runner = handler
        try:
            validate(message.body)
        except ValueError as exc:
            log.warning("invalid message %s: %s; retrying to DLQ", message.id, exc)
            queue.retry(message.lease_id, delay_seconds=RETRY_DELAY_SECONDS)
            counts["retried"] += 1
            continue
        try:
            outcome = runner(
                message.body,
                storage=storage,
                callback_client=callback_client,
                callback_url=callback_url,
                secret=secret,
                sleep=sleep,
            )
        except (StorageError, httpx.HTTPError):
            log.exception("infra failure on job %s; leaving un-acked", message.body.get("jobId"))
            continue
        if outcome["settled"]:
            try:
                queue.ack([message.lease_id])
            except Exception:
                log.exception("ack failed for %s; redelivery is idempotent", message.id)
            counts[outcome["status"]] += 1
        else:
            queue.retry(message.lease_id, delay_seconds=RETRY_DELAY_SECONDS)
            counts["retried"] += 1
    return counts