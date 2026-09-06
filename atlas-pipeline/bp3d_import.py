#!/usr/bin/env python3
"""Import BodyParts3D 4.0 geometry (as packaged by Human Atlas) into the RadioAnatome 3D layer.

WHY: RadioAnatome is a cross-sectional (CT/MRI) atlas keyed on one canonical ontology
(ontology.json). Human Atlas (github.com/ashemag/human-atlas, MIT code / CC BY 4.0 data)
packages the 2,234 BodyParts3D "isa" meshes with FMA concept ids. This script makes that
data a SOURCE for our 3D layer instead of a second anatomy app: it applies the hand-curated
canonical mapping (bp3d-map.json), rejects what fails the audit, corrects known upstream
system mis-filings, repacks the geometry for a mobile WebGL viewer, and computes the
CT/MRI <-> 3D links from the modules that actually ship.

INPUT  <human-atlas checkout>/public/models/atlas.json + body-N.bin (upstream, unmodified)
OUTPUT atlas/3d/manifest.json      viewer manifest (parts, concepts, systems, canon, links,
                                   plus the living-CT source, slice planes and the LOD set
                                   when atlas/3d/live.json / lod.json exist - see live3d.py,
                                   pack3d.mjs)
       atlas/3d/index.json         tiny canonical -> kind map for atlas.js (CT -> 3D pill)
       atlas/3d/<system>-N.bin.gz  merged geometry chunks (positions f32, normals i16,
                                   part index u16, indices u32; 4-byte aligned)
       atlas/3d/provenance.json    upstream + output checksums, rejects, modifications

Usage:
    python bp3d_import.py --src /path/to/human-atlas [--write] [--md]

Never run it as `... | tail -1`: a failing check must fail the shell.
"""
import argparse
import gzip
import hashlib
import json
import os
import struct
import subprocess
import sys
from array import array

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
OUT_DIR = os.path.join(_REPO, "atlas", "3d")
MAP = os.path.join(_HERE, "bp3d-map.json")
ONTOLOGY = os.path.join(_HERE, "ontology.json")

ATTRIBUTION = ("BodyParts3D, © The Database Center for Life Science licensed under "
               "CC Attribution 4.0 International")
LICENCE_URL = "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html"
DATASET_URL = "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html"
UPSTREAM_REPO = "https://github.com/ashemag/human-atlas"

# Display systems. Names/colours/descriptions are Human Atlas's curated table
# (app/anatomy.ts, MIT) - reused with attribution, see HUMAN_ATLAS_PROVENANCE.md.
SYSTEMS = [
    ("skeletal", "Skeleton", "#e2d9ba", "Bones form the supporting framework of the body, protect organs, and provide attachment points for muscles. Their internal tissue also stores minerals and produces blood cells."),
    ("muscular", "Muscles", "#a85b50", "Skeletal muscles generate movement by pulling on their attachments. Together with tendons, they move joints, stabilize posture, and produce heat."),
    ("cardiac", "Heart", "#b96760", "The heart is a muscular pump with four chambers. Its valves direct blood forward through the pulmonary and systemic circuits."),
    ("sensory", "Sensory organs", "#b0c8ce", "These structures contribute to special senses, including sight, hearing, and balance. Their specialized tissues detect stimuli and work with the nervous system to convey information."),
    ("arterial", "Arteries", "#c05245", "The heart drives blood through the circulation. Arteries carry blood away from the heart to supply tissues or, in the pulmonary circuit, to the lungs."),
    ("venous", "Veins", "#527c9f", "Veins return blood toward the heart. Superficial and deep networks collect blood from the tissues; the pulmonary veins bring oxygenated blood back from the lungs."),
    ("nervous", "Nervous system", "#d8b565", "The brain, spinal cord, and peripheral nerves carry and process signals. They support sensation, movement, coordination, and automatic regulation of body functions."),
    ("respiratory", "Respiratory", "#b98991", "The airways conduct air to the lungs, where oxygen and carbon dioxide move between air and blood. Breathing depends on pressure changes produced by respiratory muscles."),
    ("digestive", "Digestive", "#b8916b", "The digestive tract breaks down food, absorbs nutrients and water, and moves waste onward. Accessory organs contribute bile and digestive enzymes."),
    ("urinary", "Urinary", "#b47961", "The kidneys filter blood and regulate fluid, electrolyte, and acid-base balance. Urine travels through the ureters to the bladder and exits through the urethra."),
    ("lymphatic", "Lymphatic", "#879f7c", "Lymphatic vessels return excess tissue fluid to the circulation. Lymph nodes and other lymphoid organs support immune surveillance and responses."),
    ("endocrine", "Endocrine", "#c5a09a", "Endocrine organs release hormones into the blood to coordinate processes such as metabolism, growth, stress responses, and reproduction."),
    ("reproductive", "Reproductive", "#bda098", "The male reproductive structures represented here contribute to sperm production, maturation, transport, and the production of sex hormones."),
    ("integumentary", "Body surface", "#ba9b7d", "The body surface provides an outer anatomical reference. The integumentary system forms a protective barrier and contributes to sensation and temperature regulation."),
    ("connective", "Connective tissue", "#aec3bb", "Cartilage, ligaments, and other connective tissues support, connect, and separate structures. Their roles include stabilizing joints and distributing mechanical loads."),
]
SYS_INDEX = {s[0]: i for i, s in enumerate(SYSTEMS)}

# Organ explanations (Human Atlas app/anatomy.ts EXPLANATIONS, MIT). Keyed on lower-case name.
EXPLAIN = {
    "heart": "A muscular pump in the chest. Its right side sends blood to the lungs; its left side sends blood through the systemic circulation.",
    "liver": "A large organ beneath the right side of the diaphragm. It processes absorbed nutrients, produces bile, and synthesizes many proteins carried in the blood.",
    "brain": "The central organ of the nervous system. Its interconnected regions support perception, movement, memory, language, and the regulation of bodily functions.",
    "stomach": "A muscular chamber between the esophagus and small intestine. It stores and mixes food with acid and enzymes before releasing it into the duodenum.",
    "spleen": "A lymphoid organ in the upper left abdomen. It filters blood, removes aging blood cells, and participates in immune responses.",
    "pancreas": "An abdominal organ with digestive and endocrine roles. It supplies enzymes to the small intestine and releases hormones including insulin and glucagon.",
    "urinary bladder": "A muscular reservoir in the pelvis that stores urine arriving from the kidneys through the ureters.",
    "trachea": "The main airway connecting the larynx to the bronchi. Its cartilage supports keep the airway open during breathing.",
    "diaphragm": "A broad muscle separating the chest and abdomen. When it contracts, it increases chest volume and helps draw air into the lungs.",
}

# Body regions, same vocabulary as ontology.REGION. Order = priority when a part belongs to
# several containers (arms overlap the thorax in Y, so limbs win over trunk regions).
REGIONS = ["HEAD", "BRAIN", "NECK", "CHEST", "ABDOMEN", "PELVIS", "SPINE", "UPPER_LIMB", "LOWER_LIMB", "BODY"]
REGION_CONCEPTS = [
    ("BRAIN", ["FMA50801"]),
    ("SPINE", ["FMA13478", "FMA7647"]),
    ("HEAD", ["FMA7154"]),
    ("NECK", ["FMA7155"]),
    ("UPPER_LIMB", ["FMA7186", "FMA7185"]),
    ("LOWER_LIMB", ["FMA7188", "FMA7187"]),
    ("PELVIS", ["FMA9578", "FMA16580"]),
    ("ABDOMEN", ["FMA9577"]),
    ("CHEST", ["FMA9576"]),
]
# Y bands (metres, feet at 0) for parts that no container concept claims.
Y_BANDS = [(1.45, "HEAD"), (1.35, "NECK"), (1.05, "CHEST"), (0.85, "ABDOMEN"), (0.70, "PELVIS"), (-1, "LOWER_LIMB")]

CHUNK_LIMIT = 4_000_000  # raw bytes per chunk; keeps every file far under the 25 MiB Pages cap


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def git_head(path):
    try:
        return subprocess.check_output(["git", "-C", path, "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def load_upstream(src):
    models = os.path.join(src, "public", "models")
    manifest = json.load(open(os.path.join(models, "atlas.json")))
    bufs = {}
    inputs = {}
    for i, c in enumerate(manifest["chunks"]):
        p = os.path.join(models, os.path.basename(c["url"]))
        bufs[i] = open(p, "rb").read()
        if len(bufs[i]) != c["bytes"]:
            sys.exit(f"upstream chunk {p}: {len(bufs[i])} bytes, manifest says {c['bytes']}")
        inputs[os.path.basename(p)] = {"bytes": len(bufs[i]), "sha256": sha256(p)}
    inputs["atlas.json"] = {"bytes": os.path.getsize(os.path.join(models, "atlas.json")),
                            "sha256": sha256(os.path.join(models, "atlas.json"))}
    return manifest, bufs, inputs


def audit(parts, bufs):
    """Geometry + naming audit. Returns (kept, rejected) preserving upstream order."""
    kept, rejected, seen = [], [], {}
    for p in parts:
        b = bufs[p["chunk"]]
        name = p["name"].strip()
        why = None
        if not name or name == "-" or "Bounds(" in name:
            why = "unusable name"
        elif p["indexCount"] < 12 or p["indexCount"] % 3:
            why = f"degenerate index count {p['indexCount']}"
        else:
            pos = struct.unpack_from(f"<{p['vertexCount'] * 3}f", b, p["positions"])
            idx = array("I")
            idx.frombytes(b[p["indices"]:p["indices"] + p["indexCount"] * 4])
            lo, hi = p["bounds"]
            if any(x != x or abs(x) == float("inf") for x in pos):
                why = "non-finite vertex"
            elif max(idx) >= p["vertexCount"]:
                why = "index out of range"
            elif min(hi[i] - lo[i] for i in range(3)) <= 0:
                why = "zero-extent bounds"
            else:
                key = (name.lower(), tuple(round(v, 4) for v in lo + hi))
                if key in seen:
                    why = f"exact duplicate of {seen[key]} (same name, same bounds)"
        if why:
            rejected.append({"id": p["id"], "name": name, "conceptId": p["conceptId"], "reason": why})
        else:
            seen.setdefault((name.lower(), tuple(round(v, 4) for v in p["bounds"][0] + p["bounds"][1])), p["id"])
            kept.append(p)
    return kept, rejected


def region_of(p, concept_members):
    pid = p["id"]
    for region, fmas in REGION_CONCEPTS:
        for fma in fmas:
            if pid in concept_members.get(fma, ()):
                return region
    y = (p["bounds"][0][1] + p["bounds"][1][1]) / 2
    for floor, region in Y_BANDS:
        if y >= floor:
            return region
    return "BODY"


def build(src, write=False):
    up, bufs, inputs = load_upstream(src)
    mp = json.load(open(MAP))
    onto = json.load(open(ONTOLOGY))["structures"]
    corrections = mp["_system_corrections"]["by_name"]

    kept, rejected = audit(up["parts"], bufs)
    kept_ids = {p["id"] for p in kept}
    concept_members = {c["id"]: [e for e in c["elements"] if e in kept_ids] for c in up["concepts"]}
    concept_name = {c["id"]: c["name"] for c in up["concepts"]}

    # ---- system corrections + regions ----
    corrected = []
    for p in kept:
        fix = corrections.get(p["name"])
        if fix and fix != p["system"]:
            corrected.append({"id": p["id"], "name": p["name"], "from": p["system"], "to": fix})
            p["system"] = fix
        p["region"] = region_of(p, concept_members)

    # ---- canonical mapping ----
    canon = {}
    index_map = {}
    part_canon = {}
    mapped_full = mapped_partial = related = container = none = 0
    for cid, row in mp["structures"].items():
        if cid not in onto:
            sys.exit(f"bp3d-map.json maps {cid}, which is not in ontology.json")
        kind = row["kind"]
        entry = {"kind": kind, "fma": row.get("fma"), "note": row.get("note"),
                 "name": onto[cid]["display_name"], "region": onto[cid]["region"],
                 "definition": onto[cid].get("definition")}
        systems = set(row.get("systems") or [])

        def members(fmas):
            out = []
            for f in fmas:
                if f not in concept_members:
                    sys.exit(f"{cid}: FMA {f} is not a Human Atlas concept")
                for e in concept_members[f]:
                    if e not in out:
                        out.append(e)
            if systems:
                out = [e for e in out if part_by_id[e]["system"] in systems]
            if not out:
                sys.exit(f"{cid}: mapping resolves to zero meshes")
            return out

        part_by_id = {p["id"]: p for p in kept}
        if kind in ("concept", "composite"):
            fmas = [row["fma"]] if kind == "concept" else row["fmas"]
            entry["parts"] = members(fmas)
            entry["coverage"] = row["coverage"]
            if row["coverage"] == "full":
                mapped_full += 1
            else:
                mapped_partial += 1
            for e in entry["parts"]:
                part_canon.setdefault(e, cid)
            for side in ("left", "right"):
                if row.get(side):
                    entry[side] = {"fma": row[side], "parts": members([row[side]])}
        elif kind == "related":
            entry["related"] = members(row["fmas"])
            entry["coverage"] = "none"
            related += 1
            for side in ("left", "right"):
                if row.get(side):
                    entry[side] = {"fma": row[side], "parts": members([row[side]])}
        elif kind == "region":
            entry["region3d"] = row["region"]
            entry["coverage"] = "none"
            container += 1
        elif kind == "system":
            entry["system3d"] = row["system"]
            entry["coverage"] = "none"
            container += 1
        elif kind == "none":
            entry["reason"] = row["reason"]
            entry["coverage"] = "none"
            none += 1
        else:
            sys.exit(f"{cid}: unknown kind {kind}")
        canon[cid] = entry
        index_map[cid] = kind
    unmapped_in_ontology = sorted(set(onto) - set(mp["structures"]))
    if unmapped_in_ontology:
        sys.exit(f"ontology structures missing from bp3d-map.json: {unmapped_in_ontology}")

    # ---- CT / MRI links (from what the catalog actually ships) ----
    cat = json.load(open(os.path.join(_REPO, "atlas", "modules.json")))
    links = {}
    for m in cat["modules"]:
        ap = os.path.join(_REPO, "atlas", m["id"], "atlas.json")
        if not os.path.exists(ap):
            continue
        a = json.load(open(ap))
        first_pin = {}
        for s in a.get("slices", []):
            for pin in s.get("pins", []):
                first_pin.setdefault(pin["s"], s["i"])
        for sid in a.get("structures", {}):
            cid = sid.replace("-", "_").upper()
            if sid not in first_pin:
                continue  # declared but no geometry: nothing to correlate to
            links.setdefault(cid, []).append({
                "m": m["id"], "s": sid, "i": first_pin[sid],
                "mod": m.get("modality", "?"), "t": (m.get("title", "") + " · " + m.get("subtitle", "")).strip(" ·"),
            })

    # ---- repack geometry: per-system chunks, merged vertex streams ----
    order = sorted(kept, key=lambda p: (SYS_INDEX[p["system"]], up["parts"].index(p) if False else 0, p["id"]))
    by_system = {}
    for p in order:
        by_system.setdefault(p["system"], []).append(p)

    chunks, out_parts, files = [], [], {}
    part_index = {}
    total_tris = total_verts = 0
    for sys_id, plist in by_system.items():
        n = 0
        cur = None

        def flush():
            nonlocal cur
            if not cur or not cur["v"]:
                return
            pos = array("f", cur["pos"]).tobytes()
            nrm = array("h", cur["nrm"]).tobytes()
            pid = array("H", cur["pid"]).tobytes()
            idx = array("I", cur["idx"]).tobytes()
            blob = bytearray()
            offs = {}
            for key, data in (("pos", pos), ("nrm", nrm), ("pid", pid), ("idx", idx)):
                while len(blob) % 4:
                    blob.append(0)
                offs[key] = len(blob)
                blob.extend(data)
            raw = bytes(blob)
            gz = gzip.compress(raw, compresslevel=9, mtime=0)
            name = f"{cur['name']}.bin.gz"
            files[name] = gz
            chunks.append({"id": cur["name"], "url": f"/atlas/3d/{name}", "system": sys_id,
                           "bytes": len(raw), "gz": len(gz), "sha256": hashlib.sha256(gz).hexdigest(),
                           "v": cur["v"], "i": len(cur["idx"]), "pos": offs["pos"], "nrm": offs["nrm"],
                           "pid": offs["pid"], "idx": offs["idx"]})
            cur = None

        for p in plist:
            need = p["vertexCount"] * 20 + p["indexCount"] * 4
            if cur and cur["bytes"] + need > CHUNK_LIMIT:
                flush()
            if cur is None:
                cur = {"name": f"{sys_id}-{n}", "pos": array("f"), "nrm": array("h"), "pid": array("H"),
                       "idx": array("I"), "v": 0, "bytes": 0}
                n += 1
            b = bufs[p["chunk"]]
            vc, ic = p["vertexCount"], p["indexCount"]
            pos = array("f"); pos.frombytes(b[p["positions"]:p["positions"] + vc * 12])
            nrm = array("h"); nrm.frombytes(b[p["normals"]:p["normals"] + vc * 6])
            idx = array("I"); idx.frombytes(b[p["indices"]:p["indices"] + ic * 4])
            base = cur["v"]
            gi = len(out_parts)
            if gi > 65535:
                sys.exit("more than 65,536 parts: widen the part-index attribute")
            cur["pos"].extend(pos)
            cur["nrm"].extend(nrm)
            cur["pid"].extend(array("H", [gi] * vc))
            cur["idx"].extend(array("I", [base + x for x in idx]))
            i_start = len(cur["idx"]) - ic
            part_index[p["id"]] = gi
            out_parts.append({
                "id": p["id"], "name": p["name"], "fma": p["conceptId"], "sys": SYS_INDEX[p["system"]],
                "reg": REGIONS.index(p["region"]), "chunk": len(chunks), "iStart": i_start, "iCount": ic,
                "bounds": [round(v, 5) for v in p["bounds"][0] + p["bounds"][1]],
                "canon": part_canon.get(p["id"]),
            })
            cur["v"] += vc
            cur["bytes"] += need
            total_tris += ic // 3
            total_verts += vc
        flush()

    def idxs(ids):
        return [part_index[i] for i in ids]

    for e in canon.values():
        for k in ("parts", "related"):
            if k in e:
                e[k] = idxs(e[k])
        for side in ("left", "right"):
            if side in e:
                e[side]["parts"] = idxs(e[side]["parts"])

    concepts = [[c["id"], c["name"], idxs(concept_members[c["id"]])]
                for c in up["concepts"] if concept_members[c["id"]]]

    # ---- living-CT source (live3d.py -> pack3d.mjs live) ----
    live_path = os.path.join(OUT_DIR, "live.json")
    live = json.load(open(live_path)) if os.path.exists(live_path) else None
    sources = [{"id": "bp3d", "name": "Reference body", "short": "Reference",
                "desc": "BodyParts3D adult male reference anatomy", "frame": "bp3d"}]
    planes = {}
    live_parts = []
    if live:
        base = len(out_parts)
        chunk_base = len(chunks)
        for lp in live["parts"]:
            if lp["canon"] and lp["canon"] not in canon:
                sys.exit(f"live part {lp['id']} maps to unknown canonical {lp['canon']}")
            live_parts.append({
                "id": lp["id"], "name": lp["name"], "fma": (canon[lp["canon"]].get("fma") or "") if lp["canon"] else "",
                "sys": SYS_INDEX[lp["system"]], "reg": REGIONS.index(lp["region"]) if lp["region"] in REGIONS else REGIONS.index("BODY"),
                "chunk": chunk_base + lp["chunk"], "iStart": lp["iStart"], "iCount": lp["iCount"],
                "bounds": lp["bounds"], "canon": lp["canon"], "side": lp.get("side"),
            })
        if any(p["id"] in part_index for p in live_parts):
            sys.exit("live part id collides with a BodyParts3D id")
        for j, lp in enumerate(live_parts):
            part_index[lp["id"]] = base + j
        # the packer baked global part indices into the vertex stream: they must match
        if live.get("parts") and live["parts"][0].get("chunk") is not None:
            pass
        for c in live["chunks"]:
            chunks.append(dict(c, src=1))
        for cid, e in canon.items():
            mine = [base + j for j, lp in enumerate(live_parts) if lp["canon"] == cid]
            if mine:
                e["live"] = mine
                for side in ("left", "right"):
                    sided = [base + j for j, lp in enumerate(live_parts) if lp["canon"] == cid and lp.get("side") == side]
                    if sided:
                        e.setdefault(side, {"fma": None, "parts": []})
                        e[side]["live"] = sided
        planes = live.get("planes") or {}
        sources.append({"id": "live", "name": "Living CT", "short": "Living CT",
                        "desc": "Organ surfaces from the SAME living-patient CT as the torso slice modules "
                                "(TotalSegmentator dataset subject s0108, expert masks, CC BY 4.0)",
                        "frame": "live", "modules": sorted(planes.keys())})
        for cid, rows in links.items():
            for l in rows:
                pl = planes.get(l["m"], {}).get(str(l["i"]))
                if pl:
                    l["plane"] = 1
        total_tris += live["stats"]["triangles"]

    # ---- whole-body Visible Human source (live3d_wb.py -> pack3d.mjs wb), merged as src 2 ----
    wb_path = os.path.join(OUT_DIR, "wb.json")
    wb = json.load(open(wb_path)) if os.path.exists(wb_path) else None
    wb_parts = []
    if wb:
        base = len(out_parts) + len(live_parts)
        chunk_base = len(chunks)
        for wp in wb["parts"]:
            if wp["canon"] and wp["canon"] not in canon:
                sys.exit(f"wb part {wp['id']} maps to unknown canonical {wp['canon']}")
            wb_parts.append({
                "id": wp["id"], "name": wp["name"], "fma": (canon[wp["canon"]].get("fma") or "") if wp["canon"] else "",
                "sys": SYS_INDEX[wp["system"]], "reg": REGIONS.index(wp["region"]) if wp["region"] in REGIONS else REGIONS.index("BODY"),
                "chunk": chunk_base + wp["chunk"], "iStart": wp["iStart"], "iCount": wp["iCount"],
                "bounds": wp["bounds"], "canon": wp["canon"], "side": wp.get("side"),
            })
        if any(p["id"] in part_index for p in wb_parts):
            sys.exit("wb part id collides with an existing id")
        for j, wp in enumerate(wb_parts):
            part_index[wp["id"]] = base + j
        for c in wb["chunks"]:
            chunks.append(dict(c, src=2))
        for cid, e in canon.items():
            mine = [base + j for j, wp in enumerate(wb_parts) if wp["canon"] == cid]
            if mine:
                e["wb"] = mine
                for side in ("left", "right"):
                    sided = [base + j for j, wp in enumerate(wb_parts) if wp["canon"] == cid and wp.get("side") == side]
                    if sided:
                        e.setdefault(side, {"fma": None, "parts": []})
                        e[side]["wb"] = sided
        wb_planes = wb.get("planes") or {}
        if set(wb_planes) & set(planes):
            sys.exit("wb planes collide with living-torso planes: " + str(set(wb_planes) & set(planes)))
        planes.update(wb_planes)
        sources.append({"id": "wb", "name": "Whole body", "short": "Whole body",
                        "desc": "Head-to-toe living body from the Visible Human Project frozen CT "
                                "(U.S. National Library of Medicine), organs and skeleton via TotalSegmentator.",
                        "frame": "wb", "modules": sorted(wb_planes.keys())})
        for cid, rows in links.items():
            for l in rows:
                if wb_planes.get(l["m"], {}).get(str(l["i"])):
                    l["plane"] = 1
        total_tris += wb["stats"]["triangles"]

    # ---- mobile LOD set (pack3d.mjs lod) ----
    lod_path = os.path.join(OUT_DIR, "lod.json")
    lod = json.load(open(lod_path)) if os.path.exists(lod_path) else None

    manifest = {
        "version": 1,
        "source": {
            "dataset": up["version"], "sex": up.get("sex", "male"),
            "licence": "CC BY 4.0", "licenceUrl": LICENCE_URL, "datasetUrl": DATASET_URL,
            "attribution": ATTRIBUTION,
            "via": {"repo": UPSTREAM_REPO, "commit": git_head(src), "code_licence": "MIT"},
            "adapted": "Geometry simplified upstream (meshoptimizer, 0.2% relative error), "
                       "then repacked here into per-system chunks; 7 exact duplicate meshes "
                       "dropped; 10 display-system labels corrected. See HUMAN_ATLAS_PROVENANCE.md.",
        },
        "systems": [{"id": s[0], "name": s[1], "color": s[2], "desc": s[3]} for s in SYSTEMS],
        "regions": REGIONS,
        "explain": EXPLAIN,
        "sources": sources,
        "chunks": chunks,
        "parts": [[p["id"], p["name"], p["fma"], p["sys"], p["reg"], p["chunk"], p["iStart"], p["iCount"], p["bounds"], p["canon"], 0]
                  for p in out_parts] +
                 [[p["id"], p["name"], p["fma"], p["sys"], p["reg"], p["chunk"], p["iStart"], p["iCount"], p["bounds"], p["canon"], 1, p.get("side")]
                  for p in live_parts] +
                 [[p["id"], p["name"], p["fma"], p["sys"], p["reg"], p["chunk"], p["iStart"], p["iCount"], p["bounds"], p["canon"], 2, p.get("side")]
                  for p in wb_parts],
        "planes": planes,
        "live": ({"frame": live["frame"], "source": live["source"], "stats": live["stats"]} if live else None),
        "wb": ({"frame": wb["frame"], "source": wb["source"], "stats": wb["stats"]} if wb else None),
        "lod": ({"ratio": lod["ratio"], "error": lod["error"], "chunks": lod["chunks"], "stats": lod["stats"]} if lod else None),
        "concepts": concepts,
        "canon": canon,
        "links": links,
        "stats": {"parts": len(out_parts), "live_parts": len(live_parts), "wb_parts": len(wb_parts), "rejected": len(rejected), "triangles": total_tris,
                  "vertices": total_verts, "concepts": len(concepts),
                  "canonical": len(canon), "mapped_full": mapped_full, "mapped_partial": mapped_partial,
                  "related_only": related, "container": container, "unmapped": none,
                  "gz_bytes": sum(c["gz"] for c in chunks), "raw_bytes": sum(c["bytes"] for c in chunks)},
    }
    provenance = {
        "upstream": {"repo": UPSTREAM_REPO, "commit": git_head(src), "dataset": up["version"],
                     "licence": "CC BY 4.0", "attribution": ATTRIBUTION, "inputs": inputs},
        "rejected": rejected,
        "system_corrections": corrected,
        "outputs": {},
        "stats": manifest["stats"],
    }
    if write:
        os.makedirs(OUT_DIR, exist_ok=True)
        for name, data in files.items():
            open(os.path.join(OUT_DIR, name), "wb").write(data)
        keep = set(files) | {os.path.basename(c["url"]) for c in chunks} | ({os.path.basename(c["url"]) for c in lod["chunks"]} if lod else set())
        for old in os.listdir(OUT_DIR):
            if old.endswith(".bin.gz") and old not in keep:
                os.remove(os.path.join(OUT_DIR, old))
        mtext = json.dumps(manifest, separators=(",", ":"), ensure_ascii=False)
        open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8").write(mtext)
        open(os.path.join(OUT_DIR, "index.json"), "w").write(json.dumps(index_map, separators=(",", ":")))
        for name in sorted(os.listdir(OUT_DIR)):
            if name == "provenance.json":
                continue
            p = os.path.join(OUT_DIR, name)
            provenance["outputs"][name] = {"bytes": os.path.getsize(p), "sha256": sha256(p)}
        json.dump(provenance, open(os.path.join(OUT_DIR, "provenance.json"), "w"), indent=1)
    return manifest, provenance


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="path to a human-atlas checkout")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--md", action="store_true", help="print a markdown checksum table")
    a = ap.parse_args()
    manifest, prov = build(a.src, write=a.write)
    s = manifest["stats"]
    print(json.dumps(s, indent=1))
    print("rejected:", [(r["id"], r["reason"]) for r in prov["rejected"]])
    print("system corrections:", len(prov["system_corrections"]))
    if a.md:
        print("\n| file | bytes | sha256 |\n|---|---:|---|")
        for k, v in prov["upstream"]["inputs"].items():
            print(f"| upstream `{k}` | {v['bytes']} | `{v['sha256']}` |")
        for k, v in prov["outputs"].items():
            print(f"| `atlas/3d/{k}` | {v['bytes']} | `{v['sha256']}` |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
