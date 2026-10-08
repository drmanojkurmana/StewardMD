#!/usr/bin/env python3
"""Radiology NEET-SS notes extractor (dev-only; plan vault/plans/PrepNucleus-RadiologySS.md section 10).

Reads the owner's private radiology PDFs locally (never in git) and writes structured JSON to ~/prep-data/radnotes/ss/:
  cases.json   case-based book (RDN11): one record per "Case No. x.y" with system, history, observations, interpretation,
               diagnosis, discussion, pages and figure labels.
  tf.json      true/false anatomy MCQ book (RADN1): one record per stem with its five statements and the module heading.
Prints counts only (the PDF text is private).
usage: prep-radss-extract.py cases <RDN11.pdf> | tf <RADN1.pdf>   [--out DIR]
"""
import json, re, sys, pathlib, collections
import fitz

OUT = pathlib.Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else pathlib.Path.home() / "prep-data/radnotes/ss"
LABELS = [("history", r"Clinical (?:history|presentation)\s*:"),
          ("obs", r"Radiological techniques? and observations?\s*:?|Observations\s*:"),
          ("interp", r"Interpretations?\s*:"), ("dx", r"Principal diagnos[ie]s\s*:"), ("ddx", r"Differential diagnosis\s*:"),
          ("mgmt", r"(?:Further )?(?:management|investigations?(?: and management)?)\s*:|Management\s*:|Treatment(?: and prognosis)?\s*:"),
          ("disc", r"(?:Brief )?[Dd]iscussion(?: about the condition)?\s*:")]
LAB_RE = re.compile("|".join("(?P<%s%d>%s)" % (n, i, r) for i, (n, r) in enumerate(LABELS)))
CAP = {"history": 160, "obs": 450, "interp": 220, "dx": 60, "ddx": 160, "mgmt": 200, "disc": 650}

def clean(v):
    v = re.sub(r"Fig(?:s)?\.\s*\d+(?:\.\d+)+(?:\s*(?:to|and|,)\s*\d+(?:\.\d+)*)*", " ", v)
    v = re.sub(r"\n\s*4\.1\d\d\s+[A-Z][A-Z ,&/()-]{4,70}\s*\n", "\n", v)
    v = re.sub(r"-\n(?=[a-z])", "", v)
    return re.sub(r"\s+", " ", v).strip()

def words(v, n):
    w = v.split()
    return " ".join(w[:n])

def cases(pdf):
    """RDN11: chapters 4.121 to 4.199 (a long case each); a section may hold more than one case (one per history)."""
    d = fitz.open(pdf)
    T = [p.get_text() for p in d]
    secs = []
    for i, t in enumerate(T):
        for m in re.finditer(r"(?m)^\s*4\.(1\d\d)\s+([A-Z][A-Z ,&/()-]{4,70})\s*$", t):
            if not secs or secs[-1]["sec"] != m.group(1): secs.append({"sec": m.group(1), "system": m.group(2).strip(), "p0": i + 1})
    for k, s in enumerate(secs): s["p1"] = (secs[k + 1]["p0"] - 1) if k + 1 < len(secs) else len(T)
    out = []
    for s in secs:
        txt = "\n".join(T[s["p0"] - 1:s["p1"]])
        nfig = len(set(re.findall(r"Fig\.\s*4\.\d+\.\d+(?:\.\d+)?", txt)))
        hs = [m.start() for m in re.finditer(LABELS[0][1], txt)] or [0]
        for j, h0 in enumerate(hs):
            seg = txt[h0:(hs[j + 1] if j + 1 < len(hs) else len(txt))]
            rec = {"id": "%s-%d" % (s["sec"], j + 1), "sec": s["sec"], "system": s["system"], "pages": [s["p0"], s["p1"]], "nfig": nfig}
            ms = list(LAB_RE.finditer(seg))
            for a, m in enumerate(ms):
                name = re.sub(r"\d+$", "", m.lastgroup)
                v = clean(seg[m.end():(ms[a + 1].start() if a + 1 < len(ms) else len(seg))])
                rec[name] = (rec.get(name, "") + " " + v).strip()
            for k2, n in CAP.items():
                if rec.get(k2): rec[k2] = words(rec[k2], n)
            if rec.get("dx"):
                rec["dx"] = re.split(r"(?<=[a-z\)])\.\s", rec["dx"])[0][:200]
            out.append(rec)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "cases.json").write_text(json.dumps(out, indent=1))
    print("sections", len(secs), "cases", len(out), "with history+dx", sum(1 for r in out if r.get("history") and r.get("dx")),
          "with obs", sum(1 for r in out if r.get("obs")), "with disc", sum(1 for r in out if r.get("disc")))
    print("by system", dict(collections.Counter(r["system"] for r in out)))

def tf(pdf):
    d = fitz.open(pdf)
    toc = d.get_toc()
    sect = [(p, t) for lv, t, p in toc if lv == 3]
    def sec_at(pg):
        s = ""
        for p, t in sect:
            if p <= pg: s = t
        return s
    out = []
    for i, p in enumerate(d):
        t = p.get_text()
        for m in re.finditer(r"(?:^|\n)(\d{1,3})\.\s+(.*?)(?=\n\d{1,3}\.\s|\Z)", t, re.S):
            blk = m.group(2)
            parts = re.split(r"\n\(?([a-e])\)\s*", "\n" + blk)
            if len(parts) < 7: continue
            stem = re.sub(r"\s+", " ", parts[0]).strip()
            st = {}
            for k in range(1, len(parts) - 1, 2):
                st[parts[k]] = re.sub(r"\s+", " ", parts[k + 1]).strip()
            out.append({"n": int(m.group(1)), "page": i + 1, "section": sec_at(i + 1), "stem": stem, "st": st})
    (OUT / "tf.json").write_text(json.dumps(out, indent=1))
    print("tf stems", len(out), "by section", dict(collections.Counter(r["section"] for r in out)))
    print("answer-like lines (True/False) present:", sum(1 for r in out for v in r["st"].values() if re.match(r"(True|False)\b", v)))

if __name__ == "__main__":
    {"cases": cases, "tf": tf}[sys.argv[1]](sys.argv[2])
