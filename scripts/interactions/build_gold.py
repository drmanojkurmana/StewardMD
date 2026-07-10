"""Stage 2c — fold in StewardMD's own composition database (worker/data/gold).

Reads every gold monograph (worker/data/gold/*.json) — the app's ~1.4k drug
compositions — and produces build/gold.json: composition(generic) -> class-text.
These are added to the interaction dataset so EVERY composition the app knows is
RECOGNISED (never silently skipped) and screened; a small, safe keyword map over
the monograph `cls` string adds a class tag where it is unambiguous (RxClass
remains the authoritative classifier). Brand→composition resolution continues to
run through the existing worker brand API used by medlist.js.

Run: python scripts/interactions/build_gold.py
"""
import glob
import os
import re
import _lib as L

GOLD_DIR = os.path.join(L.ROOT, "worker", "data", "gold")

# Unambiguous cls-text keyword -> tag. Conservative on purpose: only phrases that
# map cleanly to an interaction-relevant class. RxClass output takes precedence.
CLS_KEYWORDS = [
    (r"\bnsaid\b|non-?steroidal anti-?inflammatory", ["nsaid"]),
    (r"\bppi\b|proton pump inhibitor", ["ppi"]),
    (r"macrolide", ["macrolide", "qt_prolonging"]),
    (r"fluoroquinolone|quinolone antib", ["fluoroquinolone", "qt_prolonging"]),
    (r"aminoglycoside", ["aminoglycoside", "nephrotoxic"]),
    (r"glycopeptide|vancomycin", ["glycopeptide", "nephrotoxic"]),
    (r"azole antifungal|triazole", ["azole_antifungal", "cyp3a4_inhibitor"]),
    (r"\bssri\b|selective serotonin reuptake", ["ssri", "serotonergic"]),
    (r"\bsnri\b|serotonin.norepinephrine reuptake", ["snri", "serotonergic"]),
    (r"tricyclic antidepressant|\btca\b", ["serotonergic", "qt_prolonging", "anticholinergic"]),
    (r"monoamine oxidase", ["mao_inhibitor", "serotonergic"]),
    (r"\bstatin\b|hmg-?coa reductase", ["statin"]),
    (r"fibrate|fibric acid", ["fibrate"]),
    (r"\bnitrate\b", ["nitrate", "vasodilator"]),
    (r"phosphodiesterase.?5|pde5", ["pde5_inhibitor", "vasodilator"]),
    (r"dihydropyridine", ["dihydropyridine_ccb", "calcium_channel_blocker"]),
    (r"ace inhibitor|angiotensin.converting", ["ace_inhibitor", "raas"]),
    (r"angiotensin.?(ii|2).receptor|\barb\b", ["arb", "raas"]),
    (r"loop diuretic", ["loop_diuretic", "diuretic"]),
    (r"thiazide", ["thiazide_diuretic", "diuretic"]),
    (r"beta.?blocker|beta-?adrenergic (?:antagonist|blocker)", ["beta_blocker"]),
    (r"sulfonylurea", ["sulfonylurea", "hypoglycemic"]),
    (r"\binsulin\b", ["insulin", "hypoglycemic"]),
    (r"benzodiazepine", ["benzodiazepine", "cns_depressant"]),
    (r"opioid", ["opioid", "cns_depressant"]),
    (r"anticoagulant|vitamin k antagonist|factor xa|thrombin inhibitor", ["anticoagulant"]),
    (r"antiplatelet|platelet aggregation", ["antiplatelet"]),
    (r"corticosteroid|glucocorticoid", ["corticosteroid"]),
    (r"anticholinergic|antimuscarinic", ["anticholinergic"]),
    (r"first-?generation.*antihistamine|sedating antihistamine", ["antihistamine", "anticholinergic"]),
    (r"calcineurin inhibitor", ["calcineurin_inhibitor", "cyp3a4_sensitive_substrate", "nephrotoxic"]),
    (r"cardiac glycoside", ["cardiac_glycoside"]),
    (r"methylxanthine|xanthine bronchodilator", ["methylxanthine"]),
]

_KW = [(re.compile(p, re.I), tags) for p, tags in CLS_KEYWORDS]


def run():
    out = {}
    files = sorted(glob.glob(os.path.join(GOLD_DIR, "*.json")))
    for f in files:
        try:
            d = L.load_json(f)
        except Exception:
            continue
        g = L.norm(d.get("generic") or os.path.splitext(os.path.basename(f))[0])
        if not g:
            continue
        cls = str(d.get("cls") or "")
        tags = []
        for rx, tg in _KW:
            if rx.search(cls):
                for t in tg:
                    if t not in tags:
                        tags.append(t)
        out[g] = {"cls": cls, "tags": tags}
    L.save_json(f"{L.BUILD}/gold.json", out)
    tagged = sum(1 for v in out.values() if v["tags"])
    print(f"build_gold: {len(out)} compositions ({tagged} keyword-classified) -> build/gold.json")
    return out


if __name__ == "__main__":
    run()
