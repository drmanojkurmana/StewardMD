"""Pipeline orchestrator — runs the 13 stages through the injected providers, emitting progress, and
assembles an ECGAnalysis. This is the LIVE path; with default (`none`) providers it raises
StageNotImplemented at the first unimplemented stage (→ 501 naming the stage), which is the intended
state until models are wired. Mock mode bypasses this and returns the canned sample.

The structure is production-final: real R2 fetch/cleanup, real progress streaming, real error surfacing,
real assembly. Only the per-stage model calls are pending.
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable

from app.core.errors import BadImage, KardioXError, PipelineTimeout, StageNotImplemented, UpstreamUnavailable
from app.core.logging import get_logger
from app.core.metrics import METRICS
from app.core.versioning import SCHEMA_VERSION
from app.models.ecg import AnalyzeRequest, ECGAnalysis, ECGMeasurements
from app.models.progress import StageProgress
from app.services.registry import Providers
from app.storage.r2 import R2Client

log = get_logger("pipeline")
ProgressCB = Callable[[StageProgress], Awaitable[None]] | None


def _to_kardiox(exc: BaseException, stage: str) -> KardioXError:
    if isinstance(exc, KardioXError):
        return exc
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return PipelineTimeout(f"stage '{stage}' timed out", stage=stage)
    return UpstreamUnavailable(f"stage '{stage}' failed: {type(exc).__name__}", stage=stage)


async def run_stage(name, provider, fn, *, critical, emit, pct_active, pct_done, trace):
    """Execute one stage with timeout + transient-retry + metrics + tracing + FAILURE ISOLATION.

    Returns (result, ok). A critical stage that ultimately fails raises a typed KardioXError (mapped to
    the contract, so the pipeline surfaces a clean 4xx/5xx naming the stage — never an unhandled crash).
    A non-critical stage that fails is isolated: it returns (None, False) and the pipeline continues with
    a partial result. Cancellation propagates (supports request cancellation).
    """
    await emit(name, "active", pct_active)
    attempts = (getattr(provider, "max_retries", 0) or 0) + 1
    timeout_s = getattr(provider, "timeout_s", 30.0)
    retry_on = getattr(provider, "retry_on", (UpstreamUnavailable,))
    t0 = time.monotonic()
    last: KardioXError | None = None

    for attempt in range(1, attempts + 1):
        try:
            result = await asyncio.wait_for(fn(), timeout=timeout_s)
        except asyncio.CancelledError:
            trace.append({"stage": name, "status": "cancelled"})
            raise
        except BaseException as exc:  # noqa: BLE001 — mapped to a typed error below
            last = _to_kardiox(exc, name)
            if attempt < attempts and isinstance(last, retry_on):
                METRICS.inc("kardiox_stage_retries_total", {"stage": name})
                log.info("stage.retry", stage=name, attempt=attempt, code=last.code)
                await asyncio.sleep(min(2.0, 0.2 * attempt))
                continue
            break
        else:
            elapsed = time.monotonic() - t0
            METRICS.inc("kardiox_stage_total", {"stage": name})
            METRICS.observe("kardiox_stage_duration_seconds", elapsed, {"stage": name})
            trace.append({"stage": name, "status": "done", "ms": round(elapsed * 1000, 1), "attempts": attempt})
            log.info("stage.done", stage=name, ms=round(elapsed * 1000, 1), attempts=attempt)
            await emit(name, "done", pct_done)
            return result, True

    elapsed = time.monotonic() - t0
    code = getattr(last, "code", "pipeline_unavailable")
    METRICS.inc("kardiox_stage_errors_total", {"stage": name, "code": code})
    trace.append({"stage": name, "status": "failed", "ms": round(elapsed * 1000, 1), "code": code, "critical": critical})
    log.warning("stage.failed", stage=name, ms=round(elapsed * 1000, 1), code=code, critical=critical)
    await emit(name, "failed", pct_done)
    if critical:
        raise last if last else UpstreamUnavailable(f"stage '{name}' failed", stage=name)
    return None, False


async def run_pipeline(req: AnalyzeRequest, providers: Providers, r2: R2Client, on_progress: ProgressCB = None) -> ECGAnalysis:
    async def emit(stage: str, status: str, pct: int, detail: str | None = None) -> None:
        if on_progress:
            await on_progress(StageProgress(stage=stage, status=status, pct=pct, detail=detail))

    sid = req.sessionId
    trace: list[dict] = []
    t_pipeline = time.monotonic()
    await emit("upload", "done", 5)
    image = await r2.get_image(sid)
    # defense-in-depth: re-validate the bytes we read from R2 (size + magic) before any decode.
    from app.core.config import get_settings
    from app.core.upload import validate_image_bytes
    validate_image_bytes(image, get_settings())
    original_image = image   # kept for the reconstruction digitiser (see digitization stage)
    try:
        # enhancement (critical)
        image, _ = await run_stage("enhancement", providers.preprocessing,
                                   lambda: providers.preprocessing.enhance(image),
                                   critical=True, emit=emit, pct_active=12, pct_done=18, trace=trace)

        # quality gate — a deliberate GATE: BadImage rejects (propagate); no gate configured -> skip;
        # an unexpected quality-provider error is isolated (never reject a good image on a bug).
        await emit("quality", "active", 22)
        quality_report: dict | None = None
        try:
            quality_report = await asyncio.wait_for(providers.quality.assess(image), timeout=providers.quality.timeout_s)
            trace.append({"stage": "quality", "status": "done", "gate": (quality_report or {}).get("gate")})
        except StageNotImplemented:
            trace.append({"stage": "quality", "status": "skipped"})
        except BadImage:
            trace.append({"stage": "quality", "status": "rejected"})
            METRICS.inc("kardiox_stage_errors_total", {"stage": "quality", "code": "bad_image"})
            raise
        except Exception as e:  # noqa: BLE001 — isolate provider bugs, don't reject a good image
            log.warning("quality.isolated", reason=type(e).__name__)
            trace.append({"stage": "quality", "status": "isolated"})
        await emit("quality", "done", 26)

        # layout + grid detection (best-effort, non-critical) — informs the report + digitizers
        layout_info: dict | None = None
        try:
            from app.services import layout as _layout
            layout_info = await asyncio.to_thread(_layout.detect_layout, image)
            trace.append({"stage": "layout", "status": "done", "layout": (layout_info or {}).get("layout")})
        except Exception as e:  # noqa: BLE001 — isolated; the classical digitizer detects layout too
            log.info("layout.isolated", reason=type(e).__name__)
            trace.append({"stage": "layout", "status": "isolated"})

        # digitization → signal (critical). The reconstruction digitiser does its OWN ink extraction, so
        # the photo-oriented OpenCV enhancement (grid removal + adaptive-threshold binarisation) DISTORTS
        # its trace — feed it the ORIGINAL image. The classical digitiser still wants the enhanced image.
        digi_input = original_image if getattr(providers.digitization, "name", "") == "reconstruction" else image
        traces, _ = await run_stage("digitization", providers.digitization,
                                    lambda: providers.digitization.digitize(digi_input),
                                    critical=True, emit=emit, pct_active=30, pct_done=36, trace=trace)
        digitizer_consensus = (traces or {}).get("consensus")   # present when the consensus digitizer ran
        signal, _ = await run_stage("signalExtraction", providers.wfdb,
                                    lambda: providers.wfdb.to_signal(traces),
                                    critical=True, emit=emit, pct_active=40, pct_done=46, trace=trace)

        # ── Layout gate (correctness). A printed ECG is ONE 10 s acquisition sliced into column time
        #    windows; a continuous 10 s x 12 signal exists ONLY for a true 12x1 full-disclosure. For a
        #    3x4/6x2 print we NEVER fabricate a continuous 12-lead from discontinuous 2.5 s / 5 s cells:
        #    rhythm/rate is taken from the continuous rhythm strip, and the 12-lead morphology / axis /
        #    ischemia analysis + ML classifiers are marked UNAVAILABLE (deferred), not guessed. ──
        layout = (traces or {}).get("layout")
        full12 = bool((traces or {}).get("full")) if isinstance(traces, dict) and "full" in traces else True
        # amplitude-dependent diagnosis (ST/ischemia, axis, LVH, ML classifiers) is only trustworthy when
        # the digitiser recovers calibrated amplitudes. The classical digitiser does not → rhythm only.
        amp_ok = bool((traces or {}).get("amplitudeReliable", True))
        run_twelve = full12 and amp_ok
        run_ensemble = full12          # the trained ONNX ensemble z-norms per lead → amplitude-robust
        availability = None
        specialist_candidates = []
        ensemble_dx = []

        if run_twelve:
            # specialist classifiers (MI/rare/conduction/morphology/beat) — OPTIONAL + isolated.
            try:
                from app.services.specialists import run_specialists
                specialist_candidates = await run_specialists(signal, providers.specialists)
                trace.append({"stage": "specialists", "status": "done", "candidates": len(specialist_candidates)})
            except Exception as e:  # noqa: BLE001
                log.info("specialists.isolated", reason=type(e).__name__)
            # EcgLib pretrained classifiers (Apache-2.0) — optional + isolated; positives join candidates.
            try:
                ecglib_found = await providers.ecglib.classify(signal)
                specialist_candidates = specialist_candidates + (ecglib_found or [])
                trace.append({"stage": "ecglib", "status": "done", "positives": len(ecglib_found or [])})
            except Exception as e:  # noqa: BLE001
                log.info("ecglib.isolated", reason=type(e).__name__)

        # Trained ONNX ensemble (EcgLib + ECG-Diagnosis + HeartGPT) — REAL 12-lead classifiers. Runs on any
        # continuous 12-lead: it z-normalises each lead, so it is robust to the digitiser's amplitude error
        # (unlike the amplitude-based rules) and drives the verdict even when those rules are deferred.
        # Isolated + Not-Ready-safe (classify returns [] when no models are configured — never fabricates).
        if run_ensemble:
            try:
                from app.services import ensemble as _ensemble
                ensemble_dx = await asyncio.to_thread(_ensemble.classify, signal)
                trace.append({"stage": "ensemble", "status": "done", "diagnoses": len(ensemble_dx)})
            except Exception as e:  # noqa: BLE001 — the ensemble must never break the pipeline
                log.info("ensemble.isolated", reason=type(e).__name__)

        # rhythm (critical) — for 3x4 the signal's "II" is the continuous 10 s rhythm strip; for 6x2 it is
        # the 5 s column-0 lead II. Rate/regularity from a continuous lead is valid regardless of layout.
        rhythm, _ = await run_stage("rhythm", providers.rhythm,
                                    lambda: providers.rhythm.rhythm(signal),
                                    critical=True, emit=emit, pct_active=52, pct_done=58, trace=trace)

        if run_twelve:
            _beats, _ = await run_stage("beats", providers.rhythm,
                                        lambda: providers.rhythm.beats(signal),
                                        critical=False, emit=emit, pct_active=60, pct_done=64, trace=trace)
            meas, _ = await run_stage("measurement", providers.measurement,
                                      lambda: providers.measurement.measure(signal),
                                      critical=True, emit=emit, pct_active=68, pct_done=76, trace=trace)
            morph, _ = await run_stage("morphology", providers.rhythm,
                                       lambda: providers.rhythm.morphology(signal),
                                       critical=False, emit=emit, pct_active=80, pct_done=84, trace=trace)
            st, _ = await run_stage("st", providers.measurement,
                                    lambda: providers.measurement.st(signal),
                                    critical=False, emit=emit, pct_active=86, pct_done=88, trace=trace)
            morph = morph or {}
            st = st or {}
        else:
            # No trustworthy basis for 12-lead morphology/axis/ST-ischemia + ML classifiers → mark
            # UNAVAILABLE (never guess). Rhythm/rate ONLY, from the continuous lead. Two causes:
            meas, morph, st = {}, {}, {}
            if not full12:
                secs = "2.5 s" if layout == "3x4" else ("5 s" if layout == "6x2" else "short")
                availability = (
                    "Full 12-lead analysis (morphology, axis, ST/ischemia territories, ML classifiers) is "
                    f"UNAVAILABLE for a {layout or 'multi-column'} print layout — each lead cell is only ~{secs} "
                    "and the leads are not simultaneous, so a continuous 12-lead signal cannot be formed "
                    "without fabricating data. Rhythm and rate were assessed from the continuous rhythm strip. "
                    "Capture a true 12x1 full-disclosure (or a longer rhythm strip) for complete analysis.")
                trace.append({"stage": "layoutGate", "status": "partial-layout", "layout": layout})
                # single-lead AF screen from the continuous rhythm strip (HeartGPT) — so a simple AF is
                # still diagnosed even when the full 12-lead cannot be reconstructed from a 3x4/6x2 print.
                try:
                    from app.services import ensemble as _ensemble
                    _leads = (signal or {}).get("leads", {}) or {}
                    _rl = (traces or {}).get("rhythmLead") or "II"
                    _strip = ((_leads.get(_rl) or _leads.get("II") or {}).get("mv"))
                    _fs = int((_leads.get(_rl) or _leads.get("II") or {}).get("fs") or 500)
                    ensemble_dx = _ensemble.classify_rhythm_strip(_strip, fs=_fs) or []
                    if ensemble_dx:
                        availability = "Rhythm-strip AF screen (single-lead HeartGPT) applied. " + availability
                        trace.append({"stage": "stripAf", "status": "done", "n": len(ensemble_dx)})
                except Exception as e:  # noqa: BLE001 — never break the deferral path
                    log.info("stripAf.isolated", reason=type(e).__name__)
            else:
                availability = (
                    ("The trained 12-lead ML ensemble (rhythm/conduction/AF classifiers) was applied. " if ensemble_dx else "")
                    + "Amplitude-based analysis (ST/ischemia territories, axis, LVH voltage) is UNAVAILABLE "
                    "because the classical image digitiser does not recover calibrated amplitudes reliably — "
                    "those findings would be a guess. A validated (learned) digitiser is required for "
                    "ST/ischemia + voltage criteria; rhythm/rate is from the continuous lead.")
                trace.append({"stage": "layoutGate", "status": "amplitude-unreliable", "layout": layout, "ensemble": bool(ensemble_dx)})

        # rule validation (critical)
        features = {
            "regularity": rhythm.get("regularity"),
            "ventRateBpm": rhythm.get("rateBpm"),
            "pWaves": morph.get("pWaves"),
            "fWaves": morph.get("fWaves"),
            "prMs": meas.get("prMs"), "qrsMs": meas.get("qrsMs"), "qtcMs": meas.get("qtcMs"),
            "axisDeg": meas.get("axisDeg"), "perLead": meas.get("perLead"), "st": st,
        }
        validated, _ = await run_stage("ruleValidation", providers.rules,
                                       lambda: providers.rules.validate(features),
                                       critical=True, emit=emit, pct_active=92, pct_done=95, trace=trace)

        # The trained ONNX ensemble's diagnoses drive the verdict — merge them ahead of the deterministic
        # rule diagnoses (sorted by confidence). _assemble picks diagnoses[0] as the verdict.
        if ensemble_dx:
            merged = list(ensemble_dx) + list(validated.get("diagnoses") or [])
            merged.sort(key=lambda d: -float(d.get("confidence", 0.0)))
            validated["diagnoses"] = merged

        # clinical explanation (OPTIONAL, constrained, non-blocking)
        interp, _ = await run_stage("clinicalExplanation", providers.gemini,
                                    lambda: providers.gemini.explain({"features": features, "validated": validated}),
                                    critical=False, emit=emit, pct_active=97, pct_done=98, trace=trace)
        interpretation = interp or ""

        analysis = _assemble(sid, rhythm, meas, st, validated, interpretation, providers,
                             quality_report=quality_report, layout_info=layout_info,
                             specialist_candidates=specialist_candidates,
                             digitizer_consensus=digitizer_consensus, availability=availability)
        total_ms = round((time.monotonic() - t_pipeline) * 1000, 1)
        METRICS.observe("kardiox_pipeline_duration_seconds", time.monotonic() - t_pipeline, {"mode": "live"})
        log.info("pipeline.done", total_ms=total_ms, stages=len(trace))
        await emit("report", "done", 100)
        return analysis
    finally:
        await r2.delete_image(sid)  # ephemeral: erase the upload the moment analysis ends


def _as_int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def _signal_quality(meas: dict):
    q = meas.get("quality")
    return float(q) if isinstance(q, (int, float)) else None


def _measurement_consistency(rhythm: dict, meas: dict):
    """1.0 when the rhythm-stage rate and the measurement-stage HR agree; lower as they diverge."""
    a, b = rhythm.get("rateBpm"), meas.get("heartRate")
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and max(a, b) > 0:
        return round(max(0.0, 1.0 - abs(a - b) / max(a, b)), 3)
    return None


def _assemble(sid, rhythm, meas, st, validated, interpretation, providers,
              quality_report=None, layout_info=None, specialist_candidates=None,
              digitizer_consensus=None, availability=None):
    """Build the ECGAnalysis contract from the real stage outputs + Phase-7 fusion/calibration/explain."""
    from app.core.config import get_settings
    from app.models.ecg import Differential, ECGFinding, Evidence, MorphologyRow, RedFlag

    settings = get_settings()
    diagnoses = validated.get("diagnoses", []) or []
    top = diagnoses[0] if diagnoses else None
    signal_quality = _signal_quality(meas)
    meas_consistency = _measurement_consistency(rhythm, meas)

    if top:
        verdict = top["label"]
        severity = top["severity"]
        confidence = float(top["confidence"])
        differentials = [Differential(label=d["label"], probability=float(d.get("probability", 0.0))) for d in top.get("differentials", [])]
        what_to_verify = top.get("whatToVerify") or validated.get("whatToVerify")
    else:
        verdict = rhythm.get("label", "")          # descriptive rhythm fallback (non-diagnostic)
        severity = "info"
        confidence = float(validated.get("confidence", 0.0))
        differentials = []
        what_to_verify = validated.get("whatToVerify")

    # ── Evidence fusion / consensus (only real MODEL outputs become candidates; deterministic-only
    #    pipelines fall back to the rule engine inside fuse). Fail-safe: degrade to the rule confidence.
    consensus = None
    if settings.enable_consensus_fusion:
        try:
            from app.services.differential import source_weight
            from app.services.fusion import fuse
            candidates = []
            if rhythm.get("method") == "torchecg" and rhythm.get("label"):
                candidates.append({"source": "torchecg", "label": rhythm["label"],
                                   "confidence": float(rhythm.get("confidence") or 0.5),
                                   "weight": source_weight("torchecg")})
            for c in (specialist_candidates or []):   # MI/rare/conduction/morphology/beat model outputs
                if c.get("label"):
                    src = c.get("source", c.get("task", "specialist"))
                    candidates.append({"source": src, "label": c["label"],
                                       "confidence": float(c.get("confidence") or 0.5),
                                       "weight": source_weight(src)})
            consensus = fuse(candidates, validated, signal_quality, meas_consistency)
            if consensus.get("findings"):
                confidence = float(consensus.get("overallConfidence", confidence))
        except Exception as e:  # noqa: BLE001 — fusion must never break the pipeline
            log.info("fusion.skipped", reason=type(e).__name__)
            consensus = None

    # ── Confidence calibration (identity + calibrated=False until fitted). Fail-safe.
    calibrated = None
    try:
        from app.services.calibration import ConfidenceCalibrator
        calibrator = ConfidenceCalibrator.from_config(settings)
        confidence = float(calibrator.calibrate(confidence))
        calibrated = bool(calibrator.is_calibrated)
    except Exception as e:  # noqa: BLE001
        log.info("calibration.skipped", reason=type(e).__name__)

    # ── Explainability for the top findings. Fail-safe.
    explanations = []
    if settings.enable_explainability and diagnoses:
        try:
            from app.services.explain import explain_finding
            ctx = {"measurements": meas, "st": st, "rhythm": rhythm, "validated": validated,
                   "fusion": consensus, "delineation": None, "fs": None}
            explanations = [explain_finding(dx, ctx) for dx in diagnoses[:3]]
        except Exception as e:  # noqa: BLE001
            log.info("explain.skipped", reason=type(e).__name__)
            explanations = []

    # ── Differential Diagnosis Engine — ranked differentials + uncertainty + next-step. Fail-safe.
    differential = None
    try:
        from app.services.differential import build_differential
        differential = build_differential(validated, consensus, meas, st, quality_report, signal_quality,
                                          morphology=morph, rhythm=rhythm, explanations=explanations)
        if differential and differential.get("primary"):
            # the ranked differentials become the analysis's top-N (label + confidence)
            differentials = [Differential(label=r["label"], probability=float(r.get("confidence", 0.0)))
                             for r in differential.get("differentials", [])]
            verdict = differential["primary"]["label"] or verdict
            severity = differential["primary"].get("severity", severity)
            what_to_verify = differential.get("nextStep") or what_to_verify
    except Exception as e:  # noqa: BLE001 — the DDx layer must never break the pipeline
        log.info("differential.skipped", reason=type(e).__name__)

    # findings ← every matched rule criterion (explainability)
    findings = []
    for i, m in enumerate(validated.get("matched", []), 1):
        findings.append(ECGFinding(
            id=f"f{i}", title=m["title"], detail=m.get("detail", ""), matched=True,
            weight=m.get("weight"), severity=m.get("severity", "info"),
            evidence=[Evidence(ruleId=m.get("ruleId", ""), measuredValue=m.get("detail", ""))],
        ))

    # morphology rows from measured facts
    morph_rows = [MorphologyRow(label="Rhythm", value=rhythm.get("label", "-"))]
    if st.get("territory"):
        morph_rows.append(MorphologyRow(label="ST-segment", value=f"Elevation ({st['territory']})"))
    elif st.get("perLead"):
        morph_rows.append(MorphologyRow(label="ST-segment", value="No territory elevation"))

    # a critical diagnosis raises a red flag
    red_flag = None
    if top and top["severity"] == "critical":
        red_flag = RedFlag(title=f"{top['label']} — urgent", body=top.get("whatToVerify", ""))

    # PARTIAL-layout honesty: surface the "12-lead unavailable" notice + never over-state confidence when
    # only the rhythm strip was analysed (the verdict is the descriptive rhythm, not a 12-lead diagnosis).
    if availability:
        interpretation = (availability + (" " + interpretation if interpretation else "")).strip()
        what_to_verify = availability if not what_to_verify else (availability + " " + what_to_verify)
        confidence = min(confidence, 0.6)
    band = "high" if confidence >= 0.85 else "medium" if confidence >= 0.6 else "low"
    return ECGAnalysis(
        schemaVersion=SCHEMA_VERSION,
        sessionId=sid,
        verdict=verdict,
        severity=severity,
        confidence=round(confidence, 2),
        confidenceBand=band,
        measurements=ECGMeasurements(
            ventRateBpm=_as_int(rhythm.get("rateBpm")), rhythm=rhythm.get("label", ""),
            prMs=_as_int(meas.get("prMs")), qrsMs=_as_int(meas.get("qrsMs")),
            qtcMs=_as_int(meas.get("qtcMs")), axisDeg=_as_int(meas.get("axisDeg")),
            perLead=meas.get("perLead"),
        ),
        morphology=morph_rows,
        clinicalInterpretation=interpretation,
        findings=findings,
        differentials=differentials,
        redFlag=red_flag,
        whatToVerify=what_to_verify,
        qualityReport=quality_report,
        layout=layout_info,
        digitizerConsensus=digitizer_consensus,
        signalQuality=signal_quality,
        consensus=consensus,
        differential=differential,
        explanations=explanations,
        calibrated=calibrated,
        modelVersions={"rules": providers.rules.name, "rhythm": providers.rhythm.name,
                       "measurement": providers.measurement.name, "digitization": providers.digitization.name,
                       "quality": providers.quality.name},
    )
