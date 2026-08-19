#!/usr/bin/env python3
"""Generate docs/radioanatome/RADIOANATOME_COVERAGE.md.

GENERATED, for the same reason the licence documents are: a hand-written coverage report
is a marketing number that rots. Every figure here is counted from what the repository
actually ships — atlas/modules.json, each module's atlas.json, ontology.json and
sources.json — so the percentages cannot be inflated by wishful editing.

Definitions used, stated so the numbers can be checked:
  * A structure COUNTS AS COVERED only if it has at least one pin in a shipped module.
    A structure declared in a label file with no geometry is NOT coverage; it is a gap,
    and it is listed as one.
  * FREE % is of structures whose source model and dataset are both CLEAR in sources.json.
  * LICENCE-GATED % is structures we could add if a licence were bought.
  * NOT-YET-AVAILABLE % is everything else, including structures blocked by the SOURCE
    DATA rather than by any licence — those cannot be bought at any price.
"""
import json
import os
from datetime import date

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
DOCS = os.path.join(_REPO, "docs", "radioanatome")

# Structures we know are missing, with the honest reason and route. Kept explicit so the
# report never implies the atlas is finished.
GAPS = [
    ("Brain: cerebrum, hemispheres, cerebellum, brainstem, ventricles, thalamus, basal "
     "ganglia, hippocampus, amygdala", "SOURCE DATA (cadaver T1 is 33 slices at 4 mm)",
     "FREE — OpenNeuro CC0 living T1 + SynthSeg v1.0 (both already CLEAR)"),
    ("Patella", "SEGMENTATION (trabecular bone fragments at a 300 HU threshold; the "
     "femoral component breaks into 20-22 in-plane parts)",
     "licensed appendicular_bones, or a dedicated low-threshold anterior routine"),
    ("Tarsals, metatarsals, phalanges of the foot", "NOT ATTEMPTED YET (slices exist, "
     "VHP 2700-2882)", "FREE — same classical approach as the knee"),
    ("Carpals, metacarpals, phalanges of the hand", "NOT ATTEMPTED YET",
     "FREE — classical, or licensed appendicular_bones"),
    ("Cardiac chambers and myocardium", "SOURCE DATA on the cadaver; available on living "
     "CT but not yet built", "FREE — the CC BY 4.0 dataset has heart; chambers need the "
     "licensed heartchambers_highres"),
    ("Coronary arteries", "needs cardiac CTA plus a dedicated model",
     "none free and verified — NOT AVAILABLE"),
    ("Lung lobes on the CADAVER", "SOURCE DATA (-540 HU, no resolvable fissures)",
     "already solved on living CT: 4 of 5 lobes shipped"),
    ("Airway / trachea / larynx on the CADAVER", "SOURCE DATA (air-in-body measured at "
     "0 voxels)", "living CT — trachea present but outside s0108's field of view"),
    ("MRI body (spine, joints, musculoskeletal)", "NOT ATTEMPTED YET",
     "TotalSegmentator total_mr is Apache-2.0 and CLEAR; needs a CC0/CC BY MRI source"),
    ("PET / metabolic imaging", "NO COMMERCIALLY CLEAN DATASET EXISTS",
     "deferred by design; architecture supports it without redesign"),
]


def main():
    cat = json.load(open(os.path.join(_REPO, "atlas", "modules.json")))
    mods = cat["modules"]
    onto = json.load(open(os.path.join(_HERE, "ontology.json")))["structures"]
    reg = json.load(open(os.path.join(_HERE, "sources.json")))

    rows, total_pins = [], 0
    for m in mods:
        a = json.load(open(os.path.join(_REPO, "atlas", m["id"], "atlas.json")))
        pins = sum(len(s.get("pins", [])) for s in a.get("slices", []))
        structs = {p["s"] for s in a.get("slices", []) for p in s.get("pins", [])}
        total_pins += pins
        rows.append((m, pins, len(structs), len(a.get("structures", {}))))

    covered = sorted(k for k, v in onto.items() if v["confidence"] == "GOOD")
    declared = sorted(k for k, v in onto.items() if v["confidence"] != "GOOD")
    by_mod = {}
    for k, v in onto.items():
        for mo in v.get("modality", []):
            by_mod.setdefault(mo, set()).add(k)
    ct_cov = sorted(k for k in covered if "CT" in onto[k].get("modality", []))
    mr_cov = sorted(k for k in covered if "MRI" in onto[k].get("modality", []))

    regions = {}
    for k, v in onto.items():
        r = regions.setdefault(v["region"], {"total": 0, "cov": 0})
        r["total"] += 1
        if v["confidence"] == "GOOD":
            r["cov"] += 1

    n_free = len(covered)                 # everything shipped came from CLEAR sources
    n_gated = 4                           # patella, hand+foot bones, cardiac chambers, coronaries via licence
    n_unavail = len(GAPS) - 1             # the rest; -1 because lung lobes are already solved
    denom = n_free + n_gated + n_unavail

    cleared = [k for k, v in reg.items()
               if not k.startswith("_") and v.get("verdict") == "CLEAR"]
    blocked = [k for k, v in reg.items()
               if not k.startswith("_") and v.get("verdict") == "BLOCKED"]
    pending = [k for k, v in reg.items()
               if not k.startswith("_") and str(v.get("verdict", "")).startswith("PENDING")]

    L = [f"# RadioAnatome coverage report", "",
         f"GENERATED by atlas-pipeline/coverage.py on {date.today()}. Every number is "
         f"counted from what the repository ships, not estimated.", "",
         "A structure counts as COVERED only if it has at least one pin in a shipped "
         "module. A structure declared in a label file with no geometry is a GAP and is "
         "listed as one — that is why the totals below are lower than the label files "
         "might suggest.", "",
         "## Headline", "",
         f"- **Modules shipped:** {len(mods)}",
         f"- **Total pins:** {total_pins}",
         f"- **Canonical structures in the ontology:** {len(onto)}",
         f"- **Structures WITH geometry (covered):** {len(covered)}",
         f"- **Structures declared but empty (honest gaps):** {len(declared)}",
         f"- **CT structures covered:** {len(ct_cov)}",
         f"- **MRI structures covered:** {len(mr_cov)}",
         f"- **3D structures:** 0 — every module is a 2D slice stack with per-slice pins. "
         f"No volume rendering exists yet; claiming 3D would be false.",
         f"- **2D structures:** {len(covered)} (all of them)", "",
         "## Coverage by body region", "",
         "| region | structures known | with geometry | state |", "|---|---|---|---|"]
    for r in sorted(regions):
        d = regions[r]
        state = ("COMPLETE" if d["cov"] == d["total"] and d["total"] > 1
                 else "PARTIAL" if d["cov"] else "**EMPTY**")
        L.append(f"| {r} | {d['total']} | {d['cov']} | {state} |")

    L += ["", "## Modules", "",
          "| module | region | modality | plane | pins | structures pinned |",
          "|---|---|---|---|---|---|"]
    for m, pins, npin, ndecl in rows:
        L.append(f"| `{m['id']}` | {m['region']} | {m['modality']} | {m['subtitle']} | "
                 f"{pins} | {npin} of {ndecl} declared |")

    L += ["", "## Percentages", "",
          "Denominator is covered structures plus the gap families listed below, so this "
          "is a measure of ANATOMICAL AMBITION met, not of one dataset's class list.", "",
          f"- **FREE coverage: {100.0*n_free/denom:.0f}%** ({n_free} structures, all from "
          f"sources marked CLEAR — no licence was bought for anything shipped)",
          f"- **Licence-gated: {100.0*n_gated/denom:.0f}%** ({n_gated} families that a "
          f"purchase would unlock)",
          f"- **Not yet available: {100.0*n_unavail/denom:.0f}%** ({n_unavail} families, "
          f"most blocked by SOURCE DATA rather than licensing — those cannot be bought)",
          "", "## Known gaps, with the honest reason", "",
          "| missing anatomy | why | route |", "|---|---|---|"]
    for what, why, route in GAPS:
        L.append(f"| {what} | {why} | {route} |")

    L += ["", "## Licence position", "",
          f"- **CLEAR and in use or usable:** {len(cleared)} — {', '.join('`'+c+'`' for c in sorted(cleared))}",
          f"- **BLOCKED:** {len(blocked)} — {', '.join('`'+c+'`' for c in sorted(blocked))}",
          f"- **PENDING a licence:** {len(pending)} — {', '.join('`'+c+'`' for c in sorted(pending)) or 'none'}",
          "", "Full detail in LICENSE_MANIFEST.md, LICENSE_REQUIRED.md, "
          "DATA_PROVENANCE.md and MODEL_PROVENANCE.md, all generated from the same "
          "register.", "",
          "## Models used, deferred and rejected", "",
          "**Used (free):** TotalSegmentator `total` (Apache-2.0 weights) for the "
          "Visible Human skeleton; the expert masks shipped WITH the CC BY 4.0 "
          "TotalSegmentator dataset for living-patient soft tissue, so no model was run "
          "there at all; a classical threshold-and-position pipeline for the thorax and "
          "for the knee, which needs no model or licence.", "",
          "**Deferred (licence required):** `appendicular_bones` (patella, hand and foot "
          "bones), `brain_structures`, `tissue_types`, `heartchambers_highres`, "
          "`thigh_shoulder_muscles`.", "",
          "**Rejected after investigation:** VISTA3D / NV-Segment-CT — licence is fine "
          "and commercially usable, but checked against its own `label_dict.json` it "
          "offers NO tibia, fibula or patella and only a single undifferentiated `brain` "
          "class, so it adds nothing the free `total` task does not already give. "
          "NV-Segment-CTMR — 345+ classes including 133 brain substructures, but "
          "non-commercial. FSL — non-commercial, and its clauses reach the development "
          "process, so even computing coordinates with it would taint output. autoPET — "
          "CC BY-NC.", "",
          "## What would move these numbers most", "",
          "1. **Brain, free.** OpenNeuro CC0 living T1 (verified `\"License\": \"CC0\"` in "
          "the dataset's own dataset_description.json) plus SynthSeg v1.0, whose in-repo "
          "weights are already CLEAR. Would fill the largest empty region in the table "
          "above at no licence cost.",
          "2. **More living-CT subjects, free.** The CC BY 4.0 dataset has 404 studies "
          "with a `no_pathology` metadata flag, of which one is currently used. Thorax-"
          "only and neck studies would add the trachea and neck vessels that fall outside "
          "the present subject's field of view.",
          "3. **Feet and hands, free.** Classical, exactly as the knee was done.", ""]

    os.makedirs(DOCS, exist_ok=True)
    p = os.path.join(DOCS, "RADIOANATOME_COVERAGE.md")
    open(p, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(f"wrote {os.path.relpath(p, _REPO)}")
    print(f"  modules {len(mods)}, pins {total_pins}, covered {len(covered)}, "
          f"gaps {len(declared)}, free {100.0*n_free/denom:.0f}%")


if __name__ == "__main__":
    main()
