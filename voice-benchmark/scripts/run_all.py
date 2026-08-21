#!/usr/bin/env python3
"""
run_all.py — drive the whole benchmark: model matrix x (medical + FLEURS) clips -> scored results.

Each model runs in a subprocess (isolation: a load/deps failure for one model is recorded as
{"error":...} and never sinks the others — honest, no fabrication). Aggregates to
results/BENCHMARK.json + results/BENCHMARK.md. CT2 dirs for the fine-tunes are created by startup.sh.
"""
import json, os, subprocess, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, "results"); S = os.path.join(ROOT, "scripts")
MED = os.path.join(R, "medical_corpus.jsonl")          # ref w/ entities
MEDM = os.path.join(R, "medical_manifest.jsonl")       # {id,audio,lang}
FLR = os.path.join(R, "fleurs_refs.jsonl")
FLRM = os.path.join(R, "fleurs_manifest.jsonl")
CT2_TE = os.environ.get("CT2_TE", "/root/ct2-telugu-small")
CT2_HI = os.environ.get("CT2_HI", "/root/ct2-hindi-small")

# clip filters
def langs_for(kind):
    return {"all": None, "te": {"te", "te_en"}, "hi": {"hi", "hi_en"},
            "indic": {"te", "te_en", "hi", "hi_en"}}[kind]

# Order matters vs the VM run-duration cap: cheap + load-bearing models first, the slow
# large-v3-turbo LAST (it's the "ULTIMATE" tier — nice-to-have, and ~2x the CPU cost of the rest).
MODELS = [
    {"name": "whisper-small-multi",           "engine": "fw", "id": "small",           "force": True,  "clips": "all"},
    {"name": "vasista22-whisper-telugu-small","engine": "fw", "id": CT2_TE,            "force": False, "clips": "te"},
    {"name": "vasista22-whisper-hindi-small", "engine": "fw", "id": CT2_HI,            "force": False, "clips": "hi"},
    {"name": "indicconformer-600m",           "engine": "ic", "id": "ai4bharat/indic-conformer-600m-multilingual", "force": True, "clips": "indic"},
    {"name": "whisper-large-v3-turbo",        "engine": "fw", "id": "large-v3-turbo",  "force": True,  "clips": "all"},
]

def filt(manifest, want):
    rows = [json.loads(l) for l in open(manifest) if l.strip()]
    if want is None:
        return rows
    # medical langs are en/hi/te/hi_en/te_en; fleurs langs are en/hi/te -> map fleurs te->te etc.
    keep = set(want) | {l.split("_")[0] for l in want}
    return [r for r in rows if r["lang"] in want or r["lang"] in keep]

def run_model(m, out_dir):
    tmp = os.path.join(out_dir, "tmp"); os.makedirs(tmp, exist_ok=True)
    want = langs_for(m["clips"])
    res = {"model": m["name"], "id": m["id"], "engine": m["engine"], "clips": m["clips"]}
    try:
        for tag, mani, ref in [("medical", MEDM, MED), ("fleurs", FLRM, FLR)]:
            fm = os.path.join(tmp, f"{m['name']}-{tag}.manifest.jsonl")
            rows = filt(mani, want)
            if not rows:
                continue
            open(fm, "w").write("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
            hyp = os.path.join(tmp, f"{m['name']}-{tag}.hyps.jsonl")
            # IndicConformer needs NeMo — run it in its own venv (IC_PYTHON) so its deps can't
            # break the Whisper stack. Falls back to the same interpreter if IC_PYTHON unset.
            pyexe = os.environ.get("IC_PYTHON", sys.executable) if m["engine"] == "ic" else sys.executable
            cmd = [pyexe, os.path.join(S, "run_asr.py"), "--engine", m["engine"],
                   "--model", m["id"], "--manifest", fm, "--out", hyp]
            if m["force"]:
                cmd.append("--force-lang")
            subprocess.run(cmd, check=True, timeout=7200)   # 2h/tag safety net; a 16-core VM finishes each in minutes
            sc = subprocess.run([sys.executable, os.path.join(S, "score.py"), "--ref", ref,
                                 "--hyp", hyp, "--model", m["name"]], check=True, capture_output=True, text=True)
            res[tag] = json.loads(sc.stdout)
            res.setdefault("timing", {})[tag] = json.load(open(hyp + ".timing.json"))
    except subprocess.TimeoutExpired:
        res["error"] = "timeout (>2h)"
    except Exception as e:
        res["error"] = f"{type(e).__name__}: {e}"
    return res

def main():
    # resume: reuse any model already scored in a prior (interrupted) run so a restart doesn't redo it
    bj = os.path.join(R, "BENCHMARK.json")
    prior = json.load(open(bj)) if os.path.exists(bj) else {"results": []}
    done = {r["model"]: r for r in prior.get("results", []) if not r.get("error")}
    out = {"date": datetime.datetime.utcnow().isoformat() + "Z",
           "host": os.uname().nodename, "results": []}
    for m in MODELS:
        if m["name"] in done:
            print(f"=== {m['name']} (cached, skip) ===", flush=True)
            out["results"].append(done[m["name"]])
            json.dump(out, open(bj, "w"), ensure_ascii=False, indent=2)
            continue
        print(f"=== {m['name']} ===", flush=True)
        out["results"].append(run_model(m, R))
        json.dump(out, open(bj, "w"), ensure_ascii=False, indent=2)
    # markdown summary
    lines = ["# Voice benchmark — MEASURED results", "", f"Run: {out['date']} on `{out['host']}`", ""]
    lines += ["| Model | status | te WER | hi WER | en WER | te_en WER | hi_en WER | clinical entity % | RTF |",
              "|---|---|---|---|---|---|---|---|---|"]
    for r in out["results"]:
        if r.get("error"):
            lines.append(f"| {r['model']} | ERROR: {r['error']} | | | | | | | |"); continue
        med = r.get("medical", {}); flr = r.get("fleurs", {})
        L = med.get("languages", {}); FL = flr.get("languages", {})
        def w(d, k): return d.get(k, {}).get("WER", "")
        rtf = ""
        try: rtf = r.get("timing", {}).get("medical", {}).get("rtf", "")
        except Exception: pass
        lines.append(f"| {r['model']} | ok | {w(FL,'te')} | {w(FL,'hi')} | {w(FL,'en')} | "
                     f"{w(L,'te_en')} | {w(L,'hi_en')} | {med.get('clinical_entity_overall_pct','')} | {rtf} |")
    open(os.path.join(R, "BENCHMARK.md"), "w").write("\n".join(lines) + "\n")
    print("DONE -> results/BENCHMARK.json + BENCHMARK.md")

if __name__ == "__main__":
    main()
