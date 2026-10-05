#!/usr/bin/env python3
"""PrepNucleus module classifier, step 1 of the bank build. Dev-only, never shipped. No AI service, no cost.

MedMCQA's own topic_name is missing on about half the items and messy on the rest, so each question is placed in a
taxonomy module by meaning: a small local sentence-embedding model scores the item (stem + key option + start of the
explanation + topic_name) against every module of its subject (subject, section, module title and scope terms), and
writes the best two modules with their cosine scores. It also scores the item against every module of every MBBS
subject and keeps the best one ("x"): about a fifth of MedMCQA's items carry the wrong subject (ARDS filed under
Anatomy), and the builder moves those to the subject they belong to. tools/prep-build-bank.mjs combines this with its
keyword score and decides; without this file it falls back to keywords alone.

MODEL (pinned): BAAI/bge-small-en-v1.5 (MIT), 384 dims, CPU. About 15 minutes for all subjects on 4 cores.

RUN
  pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install sentence-transformers
  MEDMCQA_DIR=<dir with train.jsonl, validation.jsonl> python3 tools/prep-embed.py [--subject <id>]
OUT
  prep/build/embed-<subject>.json  {"model", "revision", "subject", "modules": [ids], "a": {item_id: [i1, s1, i2, s2]},
                                    "all": [every MBBS module id], "x": {item_id: [j, s]}}
  (i indexes "modules", j indexes "all", scores x1000 rounded). prep/build/vec-<subject>.npy caches the item vectors
  so a taxonomy change re-scores without re-encoding (pass --fresh to re-encode). prep/build/ is not committed.
"""
import glob
import json
import os
import sys

# PREP_EMBED_MODEL / PREP_EMBED_REVISION switch the model (measured 2026-10-05 on a blind-labelled Anatomy sample,
# items the labeller placed in Anatomy: bge-small 73%, bge-base 78%, bge-large 82%, MedEmbed-base 79%). bge-large is
# about 10x slower on CPU: run it on a machine with a GPU or Apple MPS. Pin the revision for a reproducible build.
MODEL = os.environ.get("PREP_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
REVISION = os.environ.get("PREP_EMBED_REVISION", "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a" if MODEL == "BAAI/bge-small-en-v1.5" else None)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAX_DIR = os.path.join(ROOT, "prep", "taxonomy")
OUT_DIR = os.path.join(ROOT, "prep", "build")
QUERY = "Represent this sentence for searching relevant passages: "  # bge retrieval instruction, used on the item side


def item_text(r):
    opts = [r.get("opa"), r.get("opb"), r.get("opc"), r.get("opd")]
    cop = r.get("cop")
    key = opts[cop] if isinstance(cop, int) and 0 <= cop <= 3 else ""
    exp = (r.get("exp") or "")[:240]
    topic = r.get("topic_name") or ""
    return f"{r.get('question') or ''} Answer: {key or ''}. {exp} Topic: {topic}"[:700]


def module_text(subj, sec, m):
    return f"{subj['title']}: {sec['title']}: {m['title']}. {m['scope']}"


def main():
    only = None
    if "--subject" in sys.argv:
        only = sys.argv[sys.argv.index("--subject") + 1]
    src = os.environ.get("MEDMCQA_DIR")
    if not src:
        sys.exit("set MEDMCQA_DIR (see tools/tokos-build-mcq.mjs, GET THE DATA)")
    subjects = []
    every = []
    for p in sorted(glob.glob(os.path.join(TAX_DIR, "*.json"))):
        s = json.load(open(p, encoding="utf-8"))
        if s.get("medmcqa"):
            every.append(s)
            if only is None or s["id"] == only:
                subjects.append(s)
    by_name = {}
    for fn in ("train.jsonl", "validation.jsonl"):
        for line in open(os.path.join(src, fn), encoding="utf-8"):
            if line.strip():
                r = json.loads(line)
                by_name.setdefault(r["subject_name"], []).append(r)

    from sentence_transformers import SentenceTransformer  # imported late: --help and errors stay fast
    import numpy as np
    device = os.environ.get("PREP_EMBED_DEVICE", "cpu")
    model = SentenceTransformer(MODEL, revision=REVISION, device=device)
    os.makedirs(OUT_DIR, exist_ok=True)
    all_ids, all_txt = [], []
    for s in every:
        for sec in s["sections"]:
            for m in sec["modules"]:
                all_ids.append(m["id"])
                all_txt.append(module_text(s, sec, m))
    all_e = model.encode(all_txt, batch_size=64, normalize_embeddings=True)
    for s in subjects:
        mods, mtxt = [], []
        for sec in s["sections"]:
            for m in sec["modules"]:
                mods.append(m["id"])
                mtxt.append(module_text(s, sec, m))
        rows = by_name.get(s["medmcqa"], [])
        me = model.encode(mtxt, batch_size=64, normalize_embeddings=True)
        vec = os.path.join(OUT_DIR, f"vec-{s['id']}-{MODEL.split('/')[-1]}.npy")
        if os.path.exists(vec) and "--fresh" not in sys.argv and np.load(vec).shape[0] == len(rows):
            ie = np.load(vec)
        else:
            ie = model.encode([QUERY + item_text(r) for r in rows], batch_size=64, normalize_embeddings=True, show_progress_bar=False)
            np.save(vec, ie.astype(np.float32))
        sims = ie @ me.T
        gs = ie @ all_e.T
        gbest = np.argmax(gs, axis=1)
        top = np.argsort(-sims, axis=1)[:, :2]
        out, x = {}, {}
        for k, (r, t, row) in enumerate(zip(rows, top, sims)):
            out[r["id"]] = [int(t[0]), int(round(float(row[t[0]]) * 1000)), int(t[1]), int(round(float(row[t[1]]) * 1000))]
            j = int(gbest[k])
            x[r["id"]] = [j, int(round(float(gs[k, j]) * 1000))]
        path = os.path.join(OUT_DIR, f"embed-{s['id']}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"model": MODEL, "revision": REVISION, "subject": s["id"], "modules": mods, "a": out, "all": all_ids, "x": x}, f, separators=(",", ":"), sort_keys=True)
        print(f"{s['id']}: {len(rows)} items x {len(mods)} modules -> {os.path.relpath(path, ROOT)}", flush=True)


if __name__ == "__main__":
    main()
