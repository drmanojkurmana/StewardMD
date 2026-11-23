"""Phase 5D 'stats_model' job handler for the research worker.

Input: a queue message pointing at a frozen dataset snapshot in R2 plus a
model spec; output: result.json (aggregate statistics + manifest, never
rows). The worker package is NOT edited by this module.

Registration (one line the orchestrator adds to the worker's drain loop in
backend/research/worker/research_worker/jobs.py, drain_once):

    outcome = (stats_job.run_job if message.body.get("kind") == "stats_model" else run_job)(message.body, storage=storage, callback_client=callback_client, callback_url=callback_url, secret=secret, sleep=sleep)

with `from stats import job as stats_job` at the top of that file.
Accompanying orchestrator-owned wiring (contract changes, not made here):
- route validation: kind 'stats_model' messages go to stats_job.validate_message
  (the worker's validate_message only accepts pdf_extract);
- add 'stats_model' to the kind enum in job-message.schema.json;
- the container image must ship backend/research/stats/ on PYTHONPATH
  (the Dockerfile currently COPYs only app/ and worker/).

run_job has the same signature and return shape as research_worker.jobs.run_job
({status, settled, skipped, error}), reuses the worker's HMAC callback and
idempotency/cancel key layout, and acks only via the caller after settled.

Message shape (input pointers, no content, no PHI):
    {v: 1, kind: "stats_model", jobId, projectId, idempotencyKey, createdAt,
     input: {r2Key: "projects/<pid>/data/snapshots/<importId>.csv",
             model: {family: "linear"|"logistic"|"km"|"logrank"|"cox"|"diagnostic", ...},
             compliance: {ipdApproved: true, evidenceId: "..."}},
     ceilings: {maxSeconds: 1..240, maxRows: 1..100000}}

Model specs:
    linear/logistic: {family, formula: "y ~ x1 + x2", robust?: "HC3" (linear)}
    km:              {family, time: "<col>", event: "<col 0/1>"}
    logrank:         {family, time, event, group: "<col>"}
    cox:             {family, time, event, covariates: ["<col>", ...]}
    diagnostic:      {family, columns: {TP: "<col>", FN, FP, TN}, id?: "<col>"}

IPD rule (5C.3): the compliance flag is mandatory and checked by every model
function before any computation. There is no LLM call in this package;
patient-level rows never reach an LLM. Rows are read from R2 into this
process only; result.json carries aggregates and a data hash, never rows.
The callback carries codes and pointers only (callback.md).

Stable error codes: input_missing, invalid_message, dataset_invalid,
invalid_spec, ipd_gate, ceiling_rows, ceiling_seconds, stats_failed, plus
the model-level codes (invalid_formula, zero_cell, no_events, ...).
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import time

from ._common import IpdGateError, __version__
from .diagnostic import per_study_accuracy, reitsma
from .regression import linear_regression, logistic_regression
from .survival import cox_ph, kaplan_meier, log_rank

log = logging.getLogger("research_stats.job")

KIND = "stats_model"
GLOBAL_MAX_SECONDS = 240
GLOBAL_MAX_ROWS = 100_000
FAMILIES = ("linear", "logistic", "km", "logrank", "cox", "diagnostic")
R2_KEY_RE = re.compile(r"^projects/[A-Za-z0-9_-]+/data/(snapshots/)?[A-Za-z0-9_.-]+\.(csv|json)$")
_CODE_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class StatsJobError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def validate_message(msg) -> None:
    """Raise ValueError when a stats_model message is malformed."""
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
    for field, limit in (("maxSeconds", GLOBAL_MAX_SECONDS), ("maxRows", GLOBAL_MAX_ROWS)):
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
    model = inp.get("model")
    if not isinstance(model, dict) or model.get("family") not in FAMILIES:
        raise ValueError("bad input.model")
    if not isinstance(inp.get("compliance"), dict):
        raise ValueError("bad input.compliance")


def _parse_dataset(data: bytes, key: str) -> dict:
    """CSV snapshot (data-import.md) or JSON columns/rows -> column dict."""
    try:
        text = data.decode("utf-8-sig")
        if key.endswith(".json"):
            obj = json.loads(text)
            if isinstance(obj, dict) and isinstance(obj.get("columns"), dict):
                return obj["columns"]
            if isinstance(obj, list) and obj and all(isinstance(r, dict) for r in obj):
                names = list(obj[0])
                return {name: [r.get(name) for r in obj] for name in names}
            raise ValueError("dataset_invalid")
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise ValueError("dataset_invalid")
        rows = list(reader)
        if not rows:
            raise ValueError("dataset_invalid")
        columns = {}
        for name in reader.fieldnames:
            values = [r[name] for r in rows]
            try:
                columns[name] = [float(v) for v in values]
            except (TypeError, ValueError):
                columns[name] = values
        return columns
    except (UnicodeDecodeError, json.JSONDecodeError, csv.Error) as exc:
        raise StatsJobError("dataset_invalid") from exc


def _column(columns: dict, name: str):
    if not isinstance(name, str) or name not in columns:
        raise StatsJobError("invalid_spec")
    return columns[name]


def _run_model(model: dict, columns: dict, compliance: dict) -> dict:
    family = model["family"]
    if family in ("linear", "logistic"):
        formula = model.get("formula")
        if not isinstance(formula, str):
            raise StatsJobError("invalid_spec")
        if family == "linear":
            return linear_regression(
                columns, formula, compliance=compliance, robust=model.get("robust"),
                level=model.get("level", 0.95),
            )
        return logistic_regression(columns, formula, compliance=compliance, level=model.get("level", 0.95))
    if family in ("km", "logrank", "cox"):
        t = _column(columns, model.get("time"))
        e = _column(columns, model.get("event"))
        if family == "km":
            return kaplan_meier(t, e, compliance=compliance, level=model.get("level", 0.95))
        if family == "logrank":
            return log_rank(t, e, _column(columns, model.get("group")), compliance=compliance)
        covariates = model.get("covariates")
        if not isinstance(covariates, list) or not covariates:
            raise StatsJobError("invalid_spec")
        return cox_ph(
            t, e, {name: _column(columns, name) for name in covariates},
            compliance=compliance, level=model.get("level", 0.95),
        )
    mapping = model.get("columns")
    if not isinstance(mapping, dict) or any(c not in mapping for c in ("TP", "FN", "FP", "TN")):
        raise StatsJobError("invalid_spec")
    cols = {c: _column(columns, mapping[c]) for c in ("TP", "FN", "FP", "TN")}
    n = len(cols["TP"])
    id_col = model.get("id")
    studies = []
    for i in range(n):
        s = {c: cols[c][i] for c in ("TP", "FN", "FP", "TN")}
        if id_col:
            s["id"] = _column(columns, id_col)[i]
        studies.append(s)
    kwargs = {
        "compliance": compliance,
        "correction": model.get("correction", 0.5),
        "correction_control": model.get("correctionControl", "all"),
    }
    if model.get("model") == "per-study":
        return per_study_accuracy(studies, **kwargs)
    return reitsma(studies, level=model.get("level", 0.95), **kwargs)


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
) -> dict:
    """Run one validated stats_model message; same contract as the worker's
    run_job. Returns {status, settled, skipped, error}; settled means the
    HMAC callback returned 2xx. Storage errors propagate (stay un-acked)."""
    from research_worker.jobs import cancel_key_for, result_key_for, send_callback

    job_id = msg["jobId"]
    idempotency_key = msg["idempotencyKey"]
    result_key = result_key_for(msg)
    cancel_key = cancel_key_for(msg)

    def callback(status, usage, result=None, error=None):
        payload = {"jobId": job_id, "idempotencyKey": idempotency_key, "status": status, "usage": usage}
        if status == "done":
            payload["resultKey"] = result
        if status == "failed":
            payload["error"] = error
        return send_callback(callback_client, callback_url, job_id, payload, secret, sleep=sleep, now=now)

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

    def fail(code):
        ok = callback("failed", usage(), error=code)
        return {"status": "failed", "settled": ok, "skipped": False, "error": code}

    try:
        columns = _parse_dataset(data, msg["input"]["r2Key"])
        n_rows = len(next(iter(columns.values())))
        if n_rows > min(msg["ceilings"]["maxRows"], GLOBAL_MAX_ROWS):
            return fail("ceiling_rows")
        result = _run_model(msg["input"]["model"], columns, msg["input"]["compliance"])
    except IpdGateError as exc:
        return fail(exc.code)
    except StatsJobError as exc:
        return fail(exc.code)
    except ValueError as exc:
        code = str(exc)
        return fail(code if _CODE_RE.match(code) else "stats_failed")
    except Exception:
        log.exception("stats model crashed for job %s", job_id)
        return fail("stats_failed")

    if monotonic() - start > min(msg["ceilings"]["maxSeconds"], GLOBAL_MAX_SECONDS):
        return fail("ceiling_seconds")

    stored = dict(result)
    stored.update(
        {"jobId": job_id, "idempotencyKey": idempotency_key, "status": "done",
         "usage": usage(), "engineVersion": __version__}
    )
    storage.put_bytes(result_key, json.dumps(stored, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    ok = callback("done", stored["usage"], result=result_key)
    return {"status": "done", "settled": ok, "skipped": False, "error": None}