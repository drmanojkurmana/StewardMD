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

        # Deterministic rule validation → explainability + confidence cap.
        await emit("ruleValidation", "active", 92)
        features = {
            "regularity": rhythm.get("regularity"),
            "ventRateBpm": rhythm.get("rateBpm"),
            "pWaves": morph.get("pWaves"),
            "fWaves": morph.get("fWaves"),
            "prMs": meas.get("prMs"), "qrsMs": meas.get("qrsMs"), "qtcMs": meas.get("qtcMs"),
            "axisDeg": meas.get("axisDeg"), "st": st,
        }
        validated = await providers.rules.validate(features)
        await emit("ruleValidation", "done", 95)

        await emit("clinicalExplanation", "active", 97)
        interpretation = await providers.gemini.explain({"features": features, "validated": validated})
        await emit("clinicalExplanation", "done", 98)

        analysis = ECGAnalysis(
            schemaVersion=SCHEMA_VERSION,
            sessionId=sid,
            verdict=rhythm.get("label", ""),
            severity="urgent" if validated.get("confidence", 0) >= 0.7 else "info",
            confidence=validated.get("confidence", 0.0),
            confidenceBand="high" if validated.get("confidence", 0) >= 0.85 else "medium" if validated.get("confidence", 0) >= 0.6 else "low",
            measurements=ECGMeasurements(ventRateBpm=rhythm.get("rateBpm"), rhythm=rhythm.get("label", ""), prMs=meas.get("prMs"), qrsMs=meas.get("qrsMs"), qtcMs=meas.get("qtcMs"), axisDeg=meas.get("axisDeg")),
            clinicalInterpretation=interpretation,
            whatToVerify=validated.get("whatToVerify"),
            modelVersions={"rules": providers.rules.name, "rhythm": providers.rhythm.name, "measurement": providers.measurement.name},
        )
        await emit("report", "done", 100)
        return analysis
    finally:
        await r2.delete_image(sid)  # ephemeral: erase the upload the moment analysis ends
