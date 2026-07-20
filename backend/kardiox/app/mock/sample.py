"""Canonical deterministic AF-with-RVR analysis — byte-for-byte the same result the iOS mock returns
(kardiox-models.js samples.afWithRvr). Used when KARDIOX_MODE=mock so the app connects end-to-end over
the network BEFORE any ECG model exists."""
from __future__ import annotations

from app.models.ecg import (Differential, ECGAnalysis, ECGFinding, ECGMeasurements, Evidence, MorphologyRow, RedFlag)


def af_sample(session_id: str | None = None) -> ECGAnalysis:
    return ECGAnalysis(
        schemaVersion="1.0",
        sessionId=session_id,
        createdAt="Today 08:12",
        context="Bed 14 · 12-lead",
        verdict="Atrial fibrillation",
        verdictQualifier="with rapid ventricular response",
        severity="urgent",
        confidence=0.91,
        confidenceBand="high",
        leadStripLabel="LEAD II · 25 mm/s · 10 mm/mV",
        measurements=ECGMeasurements(ventRateBpm=128, rhythm="Irreg. irregular", prMs=None, qrsMs=92, qtcMs=468, axisDeg=42),
        morphology=[
            MorphologyRow(label="P waves", value="Absent"),
            MorphologyRow(label="Fibrillatory waves", value="Present (V1)"),
            MorphologyRow(label="ST-segment", value="No acute change"),
            MorphologyRow(label="T waves", value="Non-specific"),
        ],
        clinicalInterpretation=(
            "Irregularly irregular narrow-complex tachycardia with absent P waves and a fibrillatory "
            "baseline - consistent with atrial fibrillation with RVR. No ST-segment elevation. "
            "Borderline QTc; review rate-control agents."
        ),
        findings=[
            ECGFinding(id="f1", title="Irregularly irregular R-R", detail="RR variance 0.31s · leads II, V1", matched=True, weight=0.34, severity="urgent",
                       evidence=[Evidence(lead="II", region=[10, 160], ruleId="RHY-AF-01", measuredValue="RR variance 0.31s")]),
            ECGFinding(id="f2", title="Absent P waves", detail="No consistent atrial activity", matched=True, weight=0.29, severity="urgent"),
            ECGFinding(id="f3", title="Fibrillatory baseline", detail="f-waves in V1", matched=True, weight=0.19, severity="info",
                       evidence=[Evidence(lead="V1", ruleId="MOR-FWAVE-01", measuredValue="f-waves")]),
        ],
        differentials=[
            Differential(label="Atrial fibrillation", probability=0.91),
            Differential(label="Atrial flutter (variable)", probability=0.06),
            Differential(label="MAT", probability=0.03),
        ],
        redFlag=RedFlag(title="Anticoagulation check", body="New AF with RVR - assess CHA2DS2-VASc & rate control. Confirm onset <48h before cardioversion."),
        whatToVerify="Confirm no flutter waves in inferior leads and correlate with pulse & symptoms.",
        educationalRef="atrial-fibrillation-01",
        modelVersions={"mode": "mock", "pipeline": "0.1.0"},
    )
