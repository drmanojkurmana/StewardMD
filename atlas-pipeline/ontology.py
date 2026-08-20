#!/usr/bin/env python3
"""The canonical RadioAnatome anatomy registry.

WHY: three different vocabularies now feed the atlas and they disagree about names.
TotalSegmentator says `kidney_left`, our viewer says `kidney`, FastSurfer says
`Left-Cerebral-Cortex`. Without one canonical id per structure the anatomy browser,
search and modality filter all silently fragment: `kidney`, `kidney_left` and
`Left Kidney` become three unrelated rows.

DESIGN: the registry is GENERATED from what the atlas actually ships plus the mapping
files that produced it, never hand-maintained. Hand-maintaining 200 entries alongside
the label files guarantees the two drift apart; deriving it means a structure cannot
exist in a module without appearing here.

Canonical id form: SCREAMING_SNAKE with an explicit laterality suffix only where the
source genuinely supports laterality. Visible Human asserts NO side anywhere (two
landmarks disagree on an 8% margin that flips sign), so cadaver-derived structures are
unsided by construction and get no suffix. Living-patient CT arrives with a trustworthy
DICOM orientation, so those may be sided.

Usage:
    python ontology.py --write      # regenerate ontology.json
    python ontology.py --check      # verify every shipped label resolves; exit 1 if not
"""
import argparse
import glob
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
OUT = os.path.join(_HERE, "ontology.json")

# Region for each structure family. Anything unmapped is reported, never guessed.
REGION = {
    "skull": "HEAD", "paranasal-sinus": "HEAD", "brain": "HEAD", "mandible": "HEAD",
    "head": "HEAD",
    # BRAIN is its own region, not a sub-bucket of HEAD: it is the one region whose
    # geometry must come from living MRI rather than the cadaver, so the browser needs
    # to show it separately from the skull and sinuses that DO come from Visible Human.
    "telencephalon": "BRAIN", "cerebral-cortex": "BRAIN",
    "cerebral-white-matter": "BRAIN", "corpus-callosum": "BRAIN",
    "corona-radiata": "BRAIN", "internal-capsule": "BRAIN", "fornix": "BRAIN",
    "cerebellum": "BRAIN", "brainstem": "BRAIN", "thalamus": "BRAIN",
    # added 2026-08-19: SynthSeg already separated these; they were being discarded.
    "cerebellar-cortex": "BRAIN", "cerebellar-white-matter": "BRAIN",
    "nucleus-accumbens": "BRAIN", "ventral-diencephalon": "BRAIN",
    "caudate-nucleus": "BRAIN", "putamen": "BRAIN", "globus-pallidus": "BRAIN",
    "hippocampus": "BRAIN", "amygdala": "BRAIN", "insula": "BRAIN",
    "frontal-lobe": "BRAIN", "parietal-lobe": "BRAIN", "temporal-lobe": "BRAIN",
    "occipital-lobe": "BRAIN", "lateral-ventricle": "BRAIN",
    "third-ventricle": "BRAIN", "fourth-ventricle": "BRAIN",
    "subarachnoid-space": "BRAIN", "venous-sinus": "BRAIN",
    "septum-pellucidum": "BRAIN", "central-sulcus": "BRAIN",
    "lentiform-nucleus": "BRAIN",
    "cervical-vertebra": "NECK", "thyroid-gland": "NECK", "larynx": "NECK",
    "trachea": "NECK",
    "thorax": "CHEST", "lung": "CHEST", "upper-lobe-left": "CHEST",
    "upper-lobe-right": "CHEST", "middle-lobe-right": "CHEST",
    "lower-lobe-left": "CHEST", "lower-lobe-right": "CHEST", "heart": "CHEST",
    "myocardium": "CHEST", "left-atrium": "CHEST", "right-atrium": "CHEST",
    "left-ventricle": "CHEST", "right-ventricle": "CHEST",
    "left-atrial-appendage": "CHEST", "pulmonary-artery": "CHEST",
    "pulmonary-vein": "CHEST", "aorta": "CHEST", "superior-vena-cava": "CHEST",
    "brachiocephalic-trunk": "CHEST", "brachiocephalic-vein": "CHEST",
    "subclavian-artery": "CHEST", "common-carotid-artery": "NECK",
    "esophagus": "CHEST", "thoracic-cage": "CHEST", "rib": "CHEST",
    "sternum": "CHEST", "thoracic-vertebra": "SPINE", "costal-cartilage": "CHEST",
    "abdomen": "ABDOMEN", "liver": "ABDOMEN", "spleen": "ABDOMEN",
    "pancreas": "ABDOMEN", "kidney": "ABDOMEN", "adrenal-gland": "ABDOMEN",
    "gallbladder": "ABDOMEN", "stomach": "ABDOMEN", "duodenum": "ABDOMEN",
    "small-bowel": "ABDOMEN", "colon": "ABDOMEN", "inferior-vena-cava": "ABDOMEN",
    "portal-vein": "ABDOMEN", "lumbar-vertebra": "SPINE",
    "autochthonous-back-muscle": "SPINE", "iliopsoas": "ABDOMEN",
    "pelvis": "PELVIS", "hip-bone": "PELVIS", "sacrum": "PELVIS",
    "urinary-bladder": "PELVIS", "prostate": "PELVIS", "iliac-artery": "PELVIS",
    "iliac-vein": "PELVIS", "gluteal-muscle": "PELVIS", "femur": "LOWER_LIMB", "lower-limb": "LOWER_LIMB",
    "patella": "LOWER_LIMB", "tibia": "LOWER_LIMB", "fibula": "LOWER_LIMB",
    "tarsal": "LOWER_LIMB", "metatarsal": "LOWER_LIMB",
    "phalanx-foot": "LOWER_LIMB", "foot": "LOWER_LIMB",
    "hand": "UPPER_LIMB", "hand-bone": "UPPER_LIMB",
    "clavicle": "UPPER_LIMB", "scapula": "UPPER_LIMB", "humerus": "UPPER_LIMB",
    "radius": "UPPER_LIMB", "ulna": "UPPER_LIMB", "carpal": "UPPER_LIMB",
    "metacarpal": "UPPER_LIMB",
    "skeleton": "BODY", "torso": "BODY", "vertebral-column": "SPINE", "vertebral-canal": "SPINE",
    "spinal-cord": "SPINE",
}

# Structures whose confidence is capped regardless of source, with the reason.
CAVEAT = {
    "lung": "whole organ only on cadaver CT; lobes need living aerated lung",
}


def canonical(sid):
    return sid.replace("-", "_").upper()


def _modules():
    """(module_id, module dict, atlas dict) for everything the catalog ships."""
    cat = os.path.join(_REPO, "atlas", "modules.json")
    if not os.path.exists(cat):
        return []
    mods = json.load(open(cat))["modules"]
    out = []
    for m in mods:
        p = os.path.join(_REPO, "atlas", m["id"], "atlas.json")
        if os.path.exists(p):
            out.append((m["id"], m, json.load(open(p))))
    return out


def _label_files():
    """Label files that a SHIPPED module actually uses.

    Globbing labels/ unconditionally let a DEAD file rewrite live provenance: an orphan
    labels/ct-chest-axial.json (no such module exists) declared the thoracic and abdominal
    organ ids as Visible Human, and so stamped `visible-human` onto 18 structures that in
    fact ship from the living-patient CT. A mapping file with no module cannot describe
    what shipped.
    """
    cat_path = os.path.join(_HERE, "..", "atlas", "modules.json")
    live = set()
    if os.path.exists(cat_path):
        live = {m["id"] for m in json.load(open(cat_path, encoding="utf-8"))["modules"]}
    out = {}
    for p in glob.glob(os.path.join(_HERE, "labels", "*.json")):
        lab_id = os.path.basename(p)[:-5]
        if live and lab_id not in live:
            continue
        out[lab_id] = json.load(open(p))
    return out


def build():
    labels = _label_files()
    reg = {}
    unmapped = set()

    for mod_id, mod, atlas in _modules():
        modality = mod.get("modality", "?")
        pinned = set()
        for s in atlas.get("slices", []):
            for pin in s.get("pins", []):
                pinned.add(pin["s"])

        for sid, ent in (atlas.get("structures") or {}).items():
            cid = canonical(sid)
            region = REGION.get(sid)
            if region is None:
                unmapped.add(sid)
            row = reg.setdefault(cid, {
                "canonical_id": cid,
                "display_name": ent.get("name", sid),
                "aliases": set(),
                "modality": set(),
                "laterality": "NONE_ASSERTED",
                "region": region or "UNMAPPED",
                "source_model": set(),
                "source_dataset": set(),
                "licence": set(),
                "confidence": "NOT_AVAILABLE",
                "validation": "UNVERIFIED",
                "modules": set(),
                "definition": ent.get("definition"),
            })
            row["aliases"].add(sid)
            row["modality"].add(modality)
            row["modules"].add(mod_id)
            if ent.get("definition") and not row.get("definition"):
                row["definition"] = ent["definition"]
            # A structure only counts as available where it actually has pins.
            if sid in pinned:
                row["confidence"] = "GOOD"
                row["validation"] = "HU_AND_POSITION_CHECKED"
            elif row["confidence"] == "NOT_AVAILABLE":
                row["validation"] = "NO_GEOMETRY"

    # aliases + provenance from the mapping files that produced the pins
    for lab_id, lab in labels.items():
        prov = lab.get("_geometry", "")
        model = ("expert-masks-supplied" if "EXPERT MASKS SUPPLIED" in prov.upper()
                 else "synthseg-v1" if "SynthSeg" in prov
                 else "totalsegmentator-total" if "TotalSegmentator" in prov
                 else "fastsurfer" if "FastSurfer" in prov
                 else "classical" if "hresholding" in prov or "classical" in prov.lower()
                 else "unknown")
        # Name the dataset explicitly. The previous test was `"living" in prov`, which the
        # brain's own phrase "a LIVING subject's 0.6 mm isotropic 7T MPRAGE" satisfied - so
        # the CC0 OpenNeuro brain was attributed to the CC BY 4.0 TotalSegmentator CT set.
        low = prov.lower()
        dataset = ("openneuro-cc0" if "ds003563" in low or "openneuro" in low
                   else "totalsegmentator-dataset" if "totalsegmentator_dataset" in low
                   or "totalsegmentator dataset" in low
                   else "visible-human")
        fam = "-".join(lab_id.split("-")[:2])
        for src, tgt in (lab.get("model_labels") or {}).items():
            if not tgt:
                continue
            cid = canonical(tgt)
            if cid not in reg:
                continue
            reg[cid]["aliases"].add(src)
            # A mapping only describes what SHIPPED if one of this label file's own modules
            # actually pins the structure. Without this gate a label file that merely lists
            # an id contributes a source it never produced.
            if not any(str(m).startswith(fam) for m in reg[cid]["modules"]):
                continue
            reg[cid]["source_model"].add(model)
            reg[cid]["source_dataset"].add(dataset)

    for cid, row in reg.items():
        sid = cid.lower().replace("_", "-")
        if sid in CAVEAT:
            row["caveat"] = CAVEAT[sid]
        for k in ("aliases", "modality", "source_model", "source_dataset",
                  "licence", "modules"):
            row[k] = sorted(row[k])
        if not row["licence"]:
            row["licence"] = ["see sources.json for the dataset that produced each module"]
    return reg, sorted(unmapped)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    reg, unmapped = build()
    doc = {
        "_what": "Canonical RadioAnatome anatomy registry. GENERATED by ontology.py "
                 "from atlas/*/atlas.json plus atlas-pipeline/labels/*.json. Do not "
                 "hand-edit: run `python ontology.py --write`.",
        "_laterality": "NONE_ASSERTED is the default and is correct for every Visible "
                       "Human structure: no side is claimed anywhere in this atlas "
                       "because two landmarks disagree on this cadaver. Living-patient "
                       "sources may assert a side.",
        "_confidence": "GOOD = mask passed HU and position checks and has pins in a "
                       "shipped module. NOT_AVAILABLE = the structure is declared but "
                       "has no geometry, which is deliberate and must stay visible.",
        "structures": {k: reg[k] for k in sorted(reg)},
    }
    if a.write:
        json.dump(doc, open(OUT, "w"), indent=2, ensure_ascii=True)
        print(f"wrote {OUT}")

    avail = [k for k, v in reg.items() if v["confidence"] == "GOOD"]
    missing = [k for k, v in reg.items() if v["confidence"] == "NOT_AVAILABLE"]
    print(f"canonical structures: {len(reg)}   with geometry: {len(avail)}   "
          f"declared but empty: {len(missing)}")
    by_region = {}
    for v in reg.values():
        by_region.setdefault(v["region"], []).append(v["canonical_id"])
    for r in sorted(by_region):
        n_ok = sum(1 for c in by_region[r] if reg[c]["confidence"] == "GOOD")
        print(f"   {r:12} {len(by_region[r]):>3} structures, {n_ok:>3} with geometry")
    if unmapped:
        print(f"\nUNMAPPED REGION (add to ontology.REGION): {unmapped}")
    if a.check and unmapped:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
