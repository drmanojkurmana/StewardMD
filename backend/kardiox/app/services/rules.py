"""Stage 11 — Rule validation (deterministic explainability). This is a REAL implementation, ported
from the tested frontend engine (kardiox-rules.js). It takes structured features and produces the
matched criteria + weights + a rhythm confidence, and caps confidence when findings conflict."""
from __future__ import annotations

import math

from app.services.base import RuleEngineProvider


def qtc_category(qtc: float | None, sex: str | None = None) -> str:
    if qtc is None:
        return "unknown"
    off = 10 if sex in ("F", "female") else 0
    if qtc < 350:
        return "short"
    if qtc <= 440 + off:
        return "normal"
    if qtc <= 480 + off:
        return "borderline"
    return "prolonged"


def qrs_category(qrs: float | None) -> str:
    if qrs is None:
        return "unknown"
    if qrs >= 120:
        return "wide"
    if qrs >= 110:
        return "borderline"
    return "normal"


def rate_category(bpm: float | None) -> str:
    if bpm is None:
        return "unknown"
    if bpm < 60:
        return "brady"
    if bpm > 100:
        return "tachy"
    return "normal"


# id, title, weight, severity, cluster, predicate(features) -> bool, detail(features) -> str
_RULES = [
    ("RHY-AF-01", "Irregularly irregular R-R", 0.34, "urgent", "af",
     lambda f: f.get("regularity") == "irregular",
     lambda f: f"RR variance {f.get('rrSdSec', '-')}s"),
    ("RHY-PWAVE-ABSENT", "Absent P waves", 0.29, "urgent", "af",
     lambda f: f.get("pWaves") == "absent" or f.get("prMs", "x") is None,
     lambda f: "No consistent atrial activity"),
    ("MOR-FWAVE-01", "Fibrillatory baseline", 0.19, "info", "af",
     lambda f: f.get("fWaves") is True,
     lambda f: "f-waves in V1"),
    ("MEA-QTC-PROLONG", "Prolonged QTc", 0.0, "warn", "interval",
     lambda f: qtc_category(f.get("qtcMs"), f.get("sex")) == "prolonged",
     lambda f: f"QTc {f.get('qtcMs')} ms"),
    ("MEA-QRS-WIDE", "Wide QRS", 0.0, "warn", "interval",
     lambda f: qrs_category(f.get("qrsMs")) == "wide",
     lambda f: f"QRS {f.get('qrsMs')} ms - consider BBB / ventricular origin"),
    ("RATE-TACHY", "Tachycardia", 0.0, "warn", "rate",
     lambda f: rate_category(f.get("ventRateBpm")) == "tachy",
     lambda f: f"{f.get('ventRateBpm')} bpm"),
    ("RATE-BRADY", "Bradycardia", 0.0, "warn", "rate",
     lambda f: rate_category(f.get("ventRateBpm")) == "brady",
     lambda f: f"{f.get('ventRateBpm')} bpm"),
]


def _clamp01(n: float) -> float:
    return max(0.0, min(1.0, n))


class BuiltinRules(RuleEngineProvider):
    name = "builtin"
    implemented = True

    async def validate(self, features: dict) -> dict:
        f = features or {}
        matched = []
        for rid, title, weight, severity, cluster, pred, detail in _RULES:
            try:
                hit = bool(pred(f))
            except Exception:
                hit = False
            if hit:
                matched.append({"ruleId": rid, "title": title, "detail": detail(f), "weight": weight, "severity": severity, "cluster": cluster})

        af_matched = any(m["cluster"] == "af" for m in matched)
        conflicts = []
        if af_matched and f.get("flutterWaves") is True:
            conflicts.append({"id": "CONF-AF-FLUTTER", "note": "Flutter waves with an atrial-fibrillation pattern - reconcile AF vs atrial flutter."})
        if f.get("pWaves") == "absent" and isinstance(f.get("prMs"), (int, float)) and f.get("prMs") > 0:
            conflicts.append({"id": "CONF-P-PR", "note": "PR interval measured despite absent P waves - verify atrial activity."})

        rhythm_weight = sum(m["weight"] for m in matched if m["cluster"] == "af")
        conf = _clamp01(rhythm_weight)
        cap = min(conf, 0.6) if conflicts else conf
        verify = " ".join(c["note"] for c in conflicts) if conflicts else \
            "Confirm no flutter waves in inferior leads and correlate with pulse & symptoms."
        return {
            "matched": matched,
            "confidence": round(cap, 2),
            "confidenceCapped": cap < conf,
            "conflicts": conflicts,
            "whatToVerify": verify,
        }


class NoneRules(RuleEngineProvider):
    name = "none"

    async def validate(self, features: dict) -> dict:
        self._ni()
