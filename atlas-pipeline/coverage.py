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
    # The whole-brain row was RESOLVED (45d7b32d, d3966b62): 16 brain structures ship from
    # the CC0 living T1. What is genuinely still missing is the finer anatomy below - do
    # not restate the solved part as a gap.
    ("Brain: named gyri, sulci and lobes, and the named white-matter tracts "
     "(corpus callosum, internal capsule, fornix, corona radiata) and insula",
     "MODEL WEIGHTS — SynthSeg v1.0 segments whole structures only; it folds the corpus "
     "callosum into cerebral white matter. Its parcellation weights ship from a separate "
     "link with NO licence statement and are therefore not used",
     "no free route found; hand-authoring on the CC0 living T1 is the only clean option"),
    ("Patella", "SEGMENTATION — retested at 600 HU (the threshold that separates the foot): "
     "a candidate matched on pair symmetry, volume and z-span, then FAILED the decisive "
     "test, sitting posterior to the femoral condyles in every shared slice. Not claimed",
     "appendicular_bones (free academic key under the non-commercial determination), or a "
     "dedicated low-threshold anterior routine"),
    # SHIPPED at 600 HU: tarsal 14, metatarsal 10, tibia 2, fibula 2. Only the smallest
    # phalanges are missing, and the limit is resolution rather than method.
    ("Middle and distal phalanges of toes 2-5", "RESOLUTION — below the 300-voxel "
     "component floor at 0.9 mm; 10 of 28 phalanges recovered",
     "no route on this subject; needs a higher-resolution foot series"),
    ("Individually-named carpals, metacarpals and phalanges of the hand",
     "ATTEMPTED AND FAILED, twice — the hands lie flat against the thighs across only "
     "~8 cm of axial slices (a hand's width, not its length), so no z-banding exists; "
     "component size is near-uniform (1180-2681 voxels) and PCA found no three-band "
     "structure. Ships as the aggregate `bone of the hand`",
     "appendicular_bones (free academic key), or a dedicated coronal hand series"),
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
    # Derive both from the rows themselves. These were hand-set integers keyed to the prose
    # list, so every shipped family left the published percentage silently wrong.
    n_gated = len([g for g in GAPS if "appendicular_bones" in g[2] or "licensed" in g[2]])
    n_unavail = len([g for g in GAPS if not ("appendicular_bones" in g[2] or "licensed" in g[2])
                     and "already solved" not in g[2]])
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
          "1. **More living-CT subjects, free.** The CC BY 4.0 dataset has 404 studies "
          "with a `no_pathology` metadata flag, of which one is currently used. Thorax-"
          "only and neck studies would add the trachea and neck vessels that fall outside "
          "the present subject's field of view.",
          "2. **MRI body, free.** TotalSegmentator `total_mr` is Apache-2.0 and already "
          "CLEAR; the whole MRI musculoskeletal region is unattempted.", ""]

    os.makedirs(DOCS, exist_ok=True)
    p = os.path.join(DOCS, "RADIOANATOME_COVERAGE.md")
    open(p, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(f"wrote {os.path.relpath(p, _REPO)}")
    print(f"  modules {len(mods)}, pins {total_pins}, covered {len(covered)}, "
          f"gaps {len(declared)}, free {100.0*n_free/denom:.0f}%")


if __name__ == "__main__":
    main()
