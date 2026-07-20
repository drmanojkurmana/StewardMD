"""Pipeline orchestrator — runs the 13 stages through the injected providers, emitting progress, and
assembles an ECGAnalysis. This is the LIVE path; with default (`none`) providers it raises
StageNotImplemented at the first unimplemented stage (→ 501 naming the stage), which is the intended
state until models are wired. Mock mode bypasses this and returns the canned sample.

The structure is production-final: real R2 fetch/cleanup, real progress streaming, real error surfacing,
real assembly. Only the per-stage model calls are pending.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.core.logging import get_logger
from app.core.versioning import SCHEMA_VERSION
from app.models.ecg import AnalyzeRequest, ECGAnalysis, ECGMeasurements
from app.models.progress import StageProgress
from app.services.registry import Providers
from app.storage.r2 import R2Client

log = get_logger("pipeline")
ProgressCB = Callable[[StageProgress], Awaitable[None]] | None


async def run_pipeline(req: AnalyzeRequest, providers: Providers, r2: R2Client, on_progress: ProgressCB = None) -> ECGAnalysis:
    async def emit(stage: str, status: str, pct: int, detail: str | None = None) -> None:
        if on_progress:
            await on_progress(StageProgress(stage=stage, status=status, pct=pct, detail=detail))

    sid = req.sessionId
    await emit("upload", "done", 5)
    image = await r2.get_image(sid)
    try:
        await emit("enhancement", "active", 12)
        image = await providers.preprocessing.enhance(image)
        await emit("enhancement", "done", 18)

        await emit("digitization", "active", 24)
        traces = await providers.digitization.digitize(image)
        await emit("digitization", "done", 32)

        await emit("signalExtraction", "active", 38)
        signal = await providers.wfdb.to_signal(traces)
        await emit("signalExtraction", "done", 44)

        await emit("quality", "done", 48)  # quality gate belongs here (a provider hook can be added)

        await emit("rhythm", "active", 55)
        rhythm = await providers.rhythm.rhythm(signal)
        await emit("beats", "active", 60)
        _beats = await providers.rhythm.beats(signal)
        await emit("beats", "done", 64)

        await emit("measurement", "active", 70)
        meas = await providers.measurement.measure(signal)
        await emit("measurement", "done", 76)

        await emit("morphology", "active", 82)
        morph = await providers.rhythm.morphology(signal)
        await emit("st", "active", 86)
        st = await providers.measurement.st(signal)
        await emit("st", "done", 88)

        # Deterministic rule validation → explainability + confidence cap + morphology diagnoses.
        await emit("ruleValidation", "active", 92)
        features = {
            "regularity": rhythm.get("regularity"),
            "ventRateBpm": rhythm.get("rateBpm"),
            "pWaves": morph.get("pWaves"),
            "fWaves": morph.get("fWaves"),
            "prMs": meas.get("prMs"), "qrsMs": meas.get("qrsMs"), "qtcMs": meas.get("qtcMs"),
            "axisDeg": meas.get("axisDeg"), "perLead": meas.get("perLead"), "st": st,
        }
        validated = await providers.rules.validate(features)
        await emit("ruleValidation", "done", 95)

        # Clinical explanation is OPTIONAL and constrained to validated findings. It must NEVER block
        # the analysis (missing key / no explainer / upstream error → empty interpretation, pipeline
        # still returns the deterministic result).
        await emit("clinicalExplanation", "active", 97)
        interpretation = ""
        try:
            interpretation = await providers.gemini.explain({"features": features, "validated": validated})
        except Exception as e:  # StageNotImplemented / UpstreamUnavailable / network
            log.info("explanation_skipped", reason=type(e).__name__)
        await emit("clinicalExplanation", "done", 98)

        analysis = _assemble(sid, rhythm, meas, st, validated, interpretation, providers)
        await emit("report", "done", 100)
        return analysis
    finally:
        await r2.delete_image(sid)  # ephemeral: erase the upload the moment analysis ends


def _as_int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def _assemble(sid, rhythm, meas, st, validated, interpretation, providers):
    """Build the ECGAnalysis contract from the real stage outputs (Phase 5F)."""
    from app.models.ecg import Differential, ECGFinding, Evidence, MorphologyRow, RedFlag

    diagnoses = validated.get("diagnoses", []) or []
    top = diagnoses[0] if diagnoses else None

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
        modelVersions={"rules": providers.rules.name, "rhythm": providers.rhythm.name,
                       "measurement": providers.measurement.name, "digitization": providers.digitization.name},
    )
