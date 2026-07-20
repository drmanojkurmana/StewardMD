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


# ── Phase 5E — deterministic morphology diagnoses on measured features ─────────────────────────────
# Each diagnosis is computed ONLY from measurable features (intervals, axis, per-lead voltages, ST). For
# findings that need data we don't measure yet (delta wave, T-wave polarity, U waves, coved morphology),
# the diagnosis fires on the measurable proxy and the whatToVerify names exactly what must be confirmed.
# Confidence is capped at 0.9 (decision support, never diagnostic certainty).

_DX_CAP = 0.9


def _net(f: dict, lead: str):
    return ((f.get("perLead") or {}).get(lead) or {}).get("netMv")


def _r_amp(f: dict, lead: str):
    return ((f.get("perLead") or {}).get(lead) or {}).get("rAmpMv")


def _s_amp(f: dict, lead: str):
    return ((f.get("perLead") or {}).get(lead) or {}).get("sAmpMv")


def _mk(dx_id, label, severity, criteria, differentials, verify):
    conf = min(_DX_CAP, _clamp01(sum(c.get("weight", 0.0) for c in criteria)))
    return {
        "id": dx_id, "label": label, "severity": severity, "confidence": round(conf, 2),
        "criteria": criteria, "differentials": differentials, "whatToVerify": verify,
        "evidence": [{"lead": c.get("lead", ""), "ruleId": c["id"], "measuredValue": c.get("measuredValue", "")} for c in criteria],
    }


def _dx_av_block(f):
    pr = f.get("prMs")
    if not isinstance(pr, (int, float)) or pr <= 200:
        return None
    c = [{"id": "MEA-PR-LONG", "description": "PR > 200 ms", "measuredValue": f"{pr} ms", "weight": 0.7, "matched": True}]
    return _mk("DX-AVB1", "First-degree AV block", "warn", c,
               [{"label": "First-degree AV block", "probability": 0.7}, {"label": "Higher-degree AV block", "probability": 0.3}],
               "Confirm 1:1 P:QRS (rule out 2nd/3rd-degree block); review AV-nodal-blocking drugs.")


def _dx_bbb(f):
    q = f.get("qrsMs")
    if not isinstance(q, (int, float)) or q < 120:
        return None
    v1 = _net(f, "V1")
    if v1 is not None and v1 > 0:
        pattern, diffs = "V1 net positive (rSR' pattern)", [{"label": "RBBB", "probability": 0.6}, {"label": "LBBB", "probability": 0.2}, {"label": "Ventricular rhythm", "probability": 0.2}]
    elif v1 is not None and v1 < 0:
        pattern, diffs = "V1 net negative", [{"label": "LBBB", "probability": 0.6}, {"label": "RBBB", "probability": 0.2}, {"label": "Ventricular rhythm", "probability": 0.2}]
    else:
        pattern, diffs = "pattern unspecified", [{"label": "RBBB", "probability": 0.4}, {"label": "LBBB", "probability": 0.4}, {"label": "Ventricular rhythm", "probability": 0.2}]
    c = [{"id": "MOR-QRS-WIDE", "description": "QRS >= 120 ms", "measuredValue": f"{q} ms", "weight": 0.6, "matched": True}]
    return _mk("DX-BBB", "Bundle branch block / IVCD", "warn", c, diffs,
               f"Wide QRS ({pattern}). Confirm V1 (rSR' -> RBBB) vs I/V6 (broad monophasic R -> LBBB); exclude ventricular origin.")


def _dx_lvh(f):
    s_v1 = _s_amp(f, "V1")
    r_v5, r_v6 = _r_amp(f, "V5"), _r_amp(f, "V6")
    if s_v1 is None or (r_v5 is None and r_v6 is None):
        return None
    r_lat = max([v for v in (r_v5, r_v6) if v is not None], default=0.0)
    sokolow = abs(s_v1) + r_lat
    if sokolow < 3.5:
        return None
    c = [{"id": "MOR-LVH-SL", "description": "Sokolow-Lyon (S V1 + R V5/V6) >= 3.5 mV", "measuredValue": f"{round(sokolow, 2)} mV", "weight": 0.6, "matched": True}]
    return _mk("DX-LVH", "Left ventricular hypertrophy (voltage)", "warn", c,
               [{"label": "LVH", "probability": 0.6}, {"label": "Normal variant (thin chest)", "probability": 0.4}],
               "Voltage criteria only; correlate with strain pattern, echo, and BP. Exclude LBBB (voltage criteria invalid).")


def _dx_rvh(f):
    v1 = _net(f, "V1")
    ax = f.get("axisDeg")
    if v1 is None or v1 <= 0 or not isinstance(ax, (int, float)) or ax <= 90:
        return None
    c = [
        {"id": "MOR-RVH-V1", "description": "Dominant R in V1 (net positive)", "measuredValue": f"{round(v1, 2)} mV", "weight": 0.35, "matched": True},
        {"id": "MOR-RVH-RAD", "description": "Right axis deviation", "measuredValue": f"{round(ax)} deg", "weight": 0.35, "matched": True},
    ]
    return _mk("DX-RVH", "Right ventricular hypertrophy", "warn", c,
               [{"label": "RVH", "probability": 0.6}, {"label": "Posterior MI", "probability": 0.2}, {"label": "RBBB", "probability": 0.2}],
               "Correlate with right-axis, RV strain, and clinical context (pulmonary HTN, PE). Exclude posterior MI.")


def _dx_axis(f):
    ax = f.get("axisDeg")
    if not isinstance(ax, (int, float)):
        return None
    if ax < -30:
        label, diffs = "Left axis deviation", [{"label": "LAFB", "probability": 0.5}, {"label": "Inferior MI", "probability": 0.3}, {"label": "LVH", "probability": 0.2}]
    elif ax > 90:
        label, diffs = "Right axis deviation", [{"label": "RVH", "probability": 0.4}, {"label": "LPFB", "probability": 0.3}, {"label": "Lateral MI", "probability": 0.3}]
    else:
        return None
    c = [{"id": "MEA-AXIS", "description": label, "measuredValue": f"{round(ax)} deg", "weight": 0.4, "matched": True}]
    return _mk("DX-AXIS", label, "info", c, diffs, "Correlate axis with QRS morphology and clinical context.")


def _dx_qtc(f):
    if qtc_category(f.get("qtcMs"), f.get("sex")) != "prolonged":
        return None
    c = [{"id": "MEA-QTC-PROLONG", "description": "Prolonged QTc", "measuredValue": f"{f.get('qtcMs')} ms", "weight": 0.55, "matched": True}]
    return _mk("DX-LQT", "Prolonged QTc", "warn", c,
               [{"label": "Drug-induced LQT", "probability": 0.4}, {"label": "Electrolyte (low K/Mg/Ca)", "probability": 0.4}, {"label": "Congenital LQTS", "probability": 0.2}],
               "Review QT-prolonging drugs and K+/Mg2+/Ca2+; torsades risk. Confirm QTc with a manual measurement.")


def _dx_st_elevation(f):
    st = f.get("st") or {}
    terr = st.get("territory")
    per = st.get("perLead") or {}
    if not terr:
        return None
    hits = sorted([(l, v) for l, v in per.items() if v is not None and v >= 0.1], key=lambda kv: -kv[1])
    c = [{"id": "MOR-STE", "lead": l, "description": f"ST elevation {l}", "measuredValue": f"+{round(v, 2)} mV", "weight": 0.4, "matched": True} for l, v in hits[:3]]
    if not c:
        return None
    return _mk("DX-STEMI", f"ST elevation ({terr})", "critical", c,
               [{"label": "STEMI", "probability": 0.6}, {"label": "Pericarditis", "probability": 0.2}, {"label": "Early repolarization", "probability": 0.2}],
               "URGENT: correlate with symptoms + troponin; look for reciprocal ST depression; activate STEMI pathway if clinical.")


def _dx_st_depression(f):
    per = (f.get("st") or {}).get("perLead") or {}
    hits = sorted([(l, v) for l, v in per.items() if v is not None and v <= -0.05], key=lambda kv: kv[1])
    if len(hits) < 2:
        return None
    c = [{"id": "MOR-STD", "lead": l, "description": f"ST depression {l}", "measuredValue": f"{round(v, 2)} mV", "weight": 0.35, "matched": True} for l, v in hits[:3]]
    return _mk("DX-ISCH", "ST depression", "urgent", c,
               [{"label": "Ischemia (NSTEMI)", "probability": 0.5}, {"label": "Digoxin effect", "probability": 0.25}, {"label": "LVH strain", "probability": 0.25}],
               "Correlate with symptoms + troponin; consider reciprocal changes, rate-related ischemia, digoxin.")


def _dx_wpw(f):
    pr, q = f.get("prMs"), f.get("qrsMs")
    if not (isinstance(pr, (int, float)) and pr < 120 and isinstance(q, (int, float)) and q >= 110):
        return None
    c = [
        {"id": "MEA-PR-SHORT", "description": "Short PR < 120 ms", "measuredValue": f"{pr} ms", "weight": 0.35, "matched": True},
        {"id": "MOR-QRS-WIDE2", "description": "Wide/slurred QRS >= 110 ms", "measuredValue": f"{q} ms", "weight": 0.3, "matched": True},
    ]
    return _mk("DX-WPW", "Ventricular pre-excitation (WPW pattern)", "warn", c,
               [{"label": "WPW pattern", "probability": 0.6}, {"label": "BBB", "probability": 0.25}, {"label": "Normal variant", "probability": 0.15}],
               "Confirm a delta wave (slurred QRS upstroke). Short PR + wide QRS suggests pre-excitation; assess arrhythmia risk.")


def _dx_brugada(f):
    # Conservative: needs coved ST elevation in V1-V2 with an RBBB-like pattern; we only have ST + V1 net.
    per = (f.get("st") or {}).get("perLead") or {}
    v1_st = per.get("V1")
    v1_net = _net(f, "V1")
    if v1_st is None or v1_st < 0.1 or v1_net is None or v1_net <= 0:
        return None
    c = [{"id": "MOR-BRUG", "lead": "V1", "description": "ST elevation with RBBB-like V1", "measuredValue": f"+{round(v1_st, 2)} mV", "weight": 0.3, "matched": True}]
    return _mk("DX-BRUGADA", "Possible Brugada pattern", "urgent", c,
               [{"label": "Brugada type 1 (coved)", "probability": 0.4}, {"label": "Brugada type 2 (saddleback)", "probability": 0.3}, {"label": "RBBB / normal variant", "probability": 0.3}],
               "Confirm a coved (type-1) ST morphology in V1-V2 with high leads; correlate with syncope/family history. Type distinction needs morphology review.")


def _dx_hyperk(f):
    # Conservative proxy for hyperkalemia: wide QRS + absent/flat P (peaked-T + K+ level need confirmation).
    q, pw = f.get("qrsMs"), f.get("pWaves")
    if not (isinstance(q, (int, float)) and q >= 120 and pw == "absent"):
        return None
    c = [
        {"id": "MOR-HK-QRS", "description": "Wide QRS", "measuredValue": f"{q} ms", "weight": 0.3, "matched": True},
        {"id": "MOR-HK-P", "description": "Absent/flat P waves", "measuredValue": "P absent", "weight": 0.25, "matched": True},
    ]
    return _mk("DX-HYPERK", "Possible hyperkalemia pattern", "critical", c,
               [{"label": "Hyperkalemia", "probability": 0.5}, {"label": "Sinoventricular rhythm", "probability": 0.25}, {"label": "AF with BBB", "probability": 0.25}],
               "URGENT: check serum K+ and look for peaked T waves. Wide QRS + absent P can be a pre-arrest hyperkalemia sign.")


_DX_FUNCS = [_dx_av_block, _dx_bbb, _dx_lvh, _dx_rvh, _dx_axis, _dx_qtc,
             _dx_st_elevation, _dx_st_depression, _dx_wpw, _dx_brugada, _dx_hyperk]


def morphology_diagnoses(features: dict) -> list[dict]:
    """Run all deterministic morphology diagnoses; return matched ones, most-confident first."""
    f = features or {}
    out = []
    for fn in _DX_FUNCS:
        try:
            dx = fn(f)
        except Exception:
            dx = None
        if dx:
            out.append(dx)
    out.sort(key=lambda d: -d["confidence"])
    return out


class BuiltinRules(RuleEngineProvider):
    name = "builtin"
    version = "1.1.0"
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

        # ── Phase 5F — assemble the full diagnosis list (AF cluster + deterministic morphology dx) ──
        diagnoses = []
        af_crit = [m for m in matched if m["cluster"] == "af"]
        if af_crit:
            diagnoses.append(_mk(
                "DX-AF", "Atrial fibrillation", "urgent",
                [{"id": m["ruleId"], "description": m["title"], "measuredValue": m["detail"], "weight": m["weight"], "matched": True} for m in af_crit],
                [{"label": "Atrial fibrillation", "probability": round(cap, 2)},
                 {"label": "Atrial flutter (variable block)", "probability": 0.06},
                 {"label": "Multifocal atrial tachycardia", "probability": 0.03}],
                verify,
            ))
            # keep AF confidence consistent with the (possibly capped) cluster value
            diagnoses[0]["confidence"] = round(cap, 2)
        diagnoses.extend(morphology_diagnoses(f))
        diagnoses.sort(key=lambda d: -d["confidence"])

        return {
            "matched": matched,
            "confidence": round(cap, 2),
            "confidenceCapped": cap < conf,
            "conflicts": conflicts,
            "whatToVerify": verify,
            "diagnoses": diagnoses,
        }


class NoneRules(RuleEngineProvider):
    name = "none"

    async def validate(self, features: dict) -> dict:
        self._ni()
