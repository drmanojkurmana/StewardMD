#!/usr/bin/env python3
"""finish-g1-qa.py: geometry + tesseract OCR + Claude vision judge (Messages Batch API), then decisions.
Modes: bakeoff (30 pilot cands x sonnet+haiku vs verdicts.tsv, pick model, estimate $6 budget),
       dry (pilot figs end to end), full (G1 cands). Resumable via OUT/qa.json.
Usage: finish-g1-qa.py --out DIR --mode bakeoff|dry|full [--model auto|sonnet|haiku] [--only ..]
       [--fresh] [--skip-judge] [--data DIR] [--full DIR] [--pilot-dir DIR] [--ledger FILE]"""
import json, os, sys, re, io, base64, subprocess, csv, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))

def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

L = _load("finish_g1_lib", HERE + "/finish-g1-lib.py")
_LBL = _load("finish_g1_label", HERE + "/finish-g1-label.py")
texts_full, render_full = _LBL.texts_full, _LBL.render_full
from PIL import Image

def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d

MODE = arg("--mode", "dry")
OUT = os.path.expanduser(arg("--out"))
MODEL = arg("--model", "auto")
ONLY = set(arg("--only").split(",")) if arg("--only") else None
FRESH = "--fresh" in sys.argv
SKIP_JUDGE = "--skip-judge" in sys.argv
DATA = os.path.expanduser(arg("--data", os.environ.get("REDRAW_DATA", "~/prep-data/rad/redraw")))
FULL = os.path.expanduser(arg("--full", os.environ.get("REDRAW_FULL", DATA + "/full")))
PILOT = os.path.expanduser(arg("--pilot-dir", os.path.expanduser("~/.claude/jobs/c927630f/tmp/redraw")))
LEDGER = arg("--ledger", L.LEDGER)
os.makedirs(OUT, exist_ok=True)

JUDGE = """IMAGE A is the book teaching figure (it may contain text labels). IMAGE B is a REDRAWN version that must be clinically identical but restyled, with all text intentionally removed.
Compare strictly as a radiologist checking a figure for a medical exam book. Ignore colour, style, shading, line weight and the intentional removal of text. Judge only the content.
Figure context: {desc}
Audit every arrow, pointer and dashed leader line one by one: for each, state where it starts, where it ends and which clock direction it points in A, then the same in B; ok=false if any arrow differs in place, angle (more than a few degrees), length, number of heads, or count. Count discrete structures (nodules, vessels, ribs, loops, dots, staple lines) in A and B; ok=false on any count change.
Also check: same structures (nothing added or removed); same relative positions, sizes, proportions, orientation; pathology/finding unchanged (no added, removed, exaggerated or altered lesion, gap, fracture, displacement or sign); spectral/graph windows unchanged (axes, curves, leader lines, no filled-in windows); no text, letters, numbers or garbled marks in B; nothing garbled or rebuilt from a different anatomy.
Return ONLY JSON: {{"ok": true/false, "issues": ["short concrete differences"]}}. ok=false if any check fails."""

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def ocr_words(path):
    try:
        t = subprocess.run(["tesseract", path, "-", "--psm", "11"], capture_output=True, text=True,
                           timeout=60).stdout
    except Exception:
        return None
    return [w for w in re.findall(r"[A-Za-z]{3,}", t)]

def img_b64(path, maxside=1024):
    im = Image.open(path).convert("RGB")
    if max(im.size) > maxside:
        s = maxside / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, "PNG")
    return base64.b64encode(b.getvalue()).decode(), im.size

def safe_cid(cid):
    return re.sub(r"[^a-zA-Z0-9_-]", "-", cid)[:64]

def judge_reqs(items, model):
    reqs, unmap = [], {}
    for cid, a_path, b_path, desc in items:
        a64, _ = img_b64(a_path)
        b64, _ = img_b64(b_path)
        s = safe_cid(cid)
        unmap[s] = cid
        reqs.append({"custom_id": s, "params": {
            "model": model, "max_tokens": 1500,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": "IMAGE A (book figure):"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": a64}},
                {"type": "text", "text": "IMAGE B (redrawn, text removed):"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": JUDGE.format(desc=desc[:600])}]}]}})
    return reqs, unmap

def run_batches(reqs, model, job, chunk=100, unmap=None):
    """Submit reqs in chunks, poll, return {cid: {ok, issues, in, out}} and totals.
    unmap: safe custom_id -> original cid (judge_reqs sanitises for the Batch pattern)."""
    unmap = unmap or {}
    res = {}
    ti = to = 0
    for n in range(0, len(reqs), chunk):
        part = reqs[n:n + chunk]
        b = L.batch_submit(part)
        bid = b["id"]
        print(f"  batch {bid} ({len(part)} reqs), polling...", flush=True)
        L.batch_wait(bid)
        r = L.batch_results(bid)
        bi = bo = 0
        for safe, o in r.items():
            cid = unmap.get(safe, safe)
            rr = o.get("result", {})
            if rr.get("type") != "succeeded":
                res[cid] = {"ok": False, "issues": [f"batch_{rr.get('type')}"], "in": 0, "out": 0}
                continue
            m = rr["message"]
            u = m.get("usage", {})
            bi += u.get("input_tokens", 0)
            bo += u.get("output_tokens", 0)
            txt = "".join(x.get("text", "") for x in m.get("content", []) if x.get("type") == "text")
            try:
                t = txt.strip()
                if t.startswith("```"):
                    t = t.split("\n", 1)[1].rsplit("```", 1)[0]
                if not t.startswith("{"):
                    a, b = t.find("{"), t.rfind("}")
                    t = t[a:b + 1] if a >= 0 and b > a else t
                j = json.loads(t)
                res[cid] = {"ok": bool(j.get("ok")), "issues": list(j.get("issues", []))[:8],
                            "in": u.get("input_tokens", 0), "out": u.get("output_tokens", 0)}
            except Exception:
                res[cid] = {"ok": False, "issues": ["judge_unparseable"], "in": u.get("input_tokens", 0),
                            "out": u.get("output_tokens", 0)}
        def _is_batch_err(c):
            j = res.get(unmap.get(c["custom_id"], c["custom_id"]), {})
            return (not j.get("ok", True)) and ("batch_" in str(j.get("issues")))
        L.ledger_append(f"{job}-b{n // chunk + 1}", model, bi, bo,
                        f"batch {bid}; {len(part)} redraw judges; errors {sum(1 for c in part if _is_batch_err(c))}",
                        path=LEDGER)
        ti += bi
        to += bo
        print(f"  batch done: in={bi} out={bo} ${L.cost(model, bi, bo):.4f}", flush=True)
    return res, ti, to

def pilot_items():
    spec = json.load(open(PILOT + "/pilot.json"))
    items = []  # (fig, candfile, orig_path, cand_path, desc)
    for fig, s in sorted(spec.items()):
        orig = os.path.expanduser(s["src"])
        for cf in ["lite-A1.png", "lite-B1.png", "flash-B1.png"]:
            p = f"{PILOT}/cand/{fig}/{cf}"
            if os.path.exists(p) and os.path.exists(orig):
                items.append((fig, cf, orig, p, s["desc"]))
    return items

def verdicts():
    v = {}
    for r in csv.DictReader(open(PILOT + "/verdicts.tsv"), delimiter="\t"):
        if r["fig"] == "r11-8" and r["cand"] == "det":
            continue
        key = {"lite-A1": "lite-A1.png", "lite-B1": "lite-B1.png", "flash-B1": "flash-B1.png"}.get(r["cand"])
        if key:
            v[(r["fig"], key)] = r["my_visual"]
    return v

def bakeoff():
    items = pilot_items()
    if ONLY:
        items = [x for x in items if x[0] in ONLY]
    v = verdicts()
    known_bad = {k for k, mv in v.items() if mv == "FAIL"}
    known_good = {k for k, mv in v.items() if mv.startswith("PASS")}
    print(f"bakeoff: {len(items)} cands, {len(known_bad)} known-bad, {len(known_good)} known-good", flush=True)
    qa_path = OUT + "/qa.json"
    qa = json.load(open(qa_path)) if os.path.exists(qa_path) and not FRESH else {}
    results = {}
    for model, mname in [("claude-sonnet-5-5", "sonnet"), ("claude-haiku-5-5", "haiku")]:
        key = f"bakeoff-{mname}"
        if key in qa and not FRESH:
            print(f"  {mname}: cached", flush=True)
            results[mname] = qa[key]
            continue
        if SKIP_JUDGE:
            print(f"  {mname}: skipped (--skip-judge)", flush=True)
            continue
        reqs, unmap = judge_reqs([(f"{f}|{c}", o, p, d) for f, c, o, p, d in items], model)
        res, ti, to = run_batches(reqs, model, "redraw-bakeoff-" + mname, chunk=60, unmap=unmap)
        # score vs my_visual
        tp = fp = fn = tn = 0
        for f, c, _, _, _ in items:
            j = res.get(f"{f}|{c}", {})
            pred_bad = not j.get("ok", False)
            if (f, c) in known_bad:
                tp, fn = tp + (1 if pred_bad else 0), fn + (0 if pred_bad else 1)
            elif (f, c) in known_good:
                fp, tn = fp + (1 if pred_bad else 0), tn + (0 if pred_bad else 1)
        rec = tp / max(1, tp + fn)
        prec = tp / max(1, tp + fp)
        per_call = L.cost(model, ti, to) / max(1, len(items))
        full_est = per_call * 964
        print(f"  {mname}: catch {tp}/{tp+fn} bad (recall {rec:.2f}), false-alarm {fp} (prec {prec:.2f}), "
              f"${L.cost(model,ti,to):.4f} for {len(items)} = ${per_call:.5f}/call, full-964 est ${full_est:.2f}",
              flush=True)
        results[mname] = {"tp": tp, "fn": fn, "fp": fp, "tn": tn, "in": ti, "out": to,
                          "cost": round(L.cost(model, ti, to), 4), "per_call": per_call,
                          "full_est": full_est, "judge": res}
        qa[key] = results[mname]
        json.dump(qa, open(qa_path, "w"))
    if "sonnet" in results and "haiku" in results:
        s, h = results["sonnet"], results["haiku"]
        # haiku adequate if it catches known-bad about as well (within 1 miss) and full est fits $6
        haiku_ok = h["tp"] >= s["tp"] - 1 and h["full_est"] < 6.0
        sonnet_ok = s["full_est"] < 6.0
        pick = "haiku" if haiku_ok else "sonnet"
        if not sonnet_ok and not haiku_ok:
            print("BUDGET: neither model fits $6; aborting (no full run)", flush=True)
            pick = "none"
        elif not sonnet_ok:
            pick = "haiku"
        print(f"BAKEOFF PICK: {pick} (sonnet catch {s['tp']}, haiku catch {h['tp']}; "
              f"sonnet full ${s['full_est']:.2f}, haiku full ${h['full_est']:.2f})", flush=True)
        qa["bakeoff_pick"] = pick
        json.dump(qa, open(qa_path, "w"))
        open(OUT + "/bakeoff-pick.txt", "w").write(pick + "\n")
    return qa

def qa_pilot(pick_model):
    spec = json.load(open(PILOT + "/pilot.json"))
    lab = json.load(open(PILOT + "/labels.json"))
    figs = sorted(spec) if not ONLY else sorted(set(spec) & ONLY)
    qa_path = OUT + "/qa.json"
    qa = json.load(open(qa_path)) if os.path.exists(qa_path) and not FRESH else {}
    qa.setdefault("dry", {})
    # per-candidate geometry + OCR (cheap, always run)
    for fig in figs:
        if fig in qa["dry"] and not FRESH:
            continue
        s = spec[fig]
        orig = os.path.expanduser(s["src"])
        o = Image.open(orig)
        entry = {"fig": fig, "cands": {}}
        for cf in ["lite-A1.png", "lite-B1.png", "flash-B1.png"]:
            p = f"{PILOT}/cand/{fig}/{cf}"
            if not os.path.exists(p):
                continue
            c = Image.open(p)
            ar_ok = abs(c.width / c.height - o.width / o.height) / (o.width / o.height) < 0.03
            ow = ocr_words(p)
            ocr_clean = (ow == []) if ow is not None else None
            entry["cands"][cf] = {"ar_ok": ar_ok, "ocr": (ow or [])[:12] if ow else ow,
                                  "ocr_clean": ocr_clean, "size": list(c.size)}
        # r11-8 det art passes by construction
        if fig == "r11-8":
            entry["cands"]["det"] = {"ar_ok": True, "ocr": ["exact", "labels"], "ocr_clean": False,
                                     "det": True}
        qa["dry"][fig] = entry
    json.dump(qa, open(qa_path, "w"))
    # judge via batch (reuse bakeoff judges when available)
    if not SKIP_JUDGE and pick_model in ("sonnet", "haiku"):
        bkey = f"bakeoff-{pick_model}"
        bj = (qa.get(bkey) or {}).get("judge", {})
        items = []
        for fig in figs:
            for cf in qa["dry"][fig]["cands"]:
                if cf == "det":
                    continue
                cid = f"{fig}|{cf}"
                if cid in bj:
                    qa["dry"][fig]["cands"][cf]["judge"] = {"ok": bj[cid]["ok"], "issues": bj[cid]["issues"]}
                else:
                    s = spec[fig]
                    items.append((cid, os.path.expanduser(s["src"]), f"{PILOT}/cand/{fig}/{cf}", s["desc"]))
        if items:
            model = "claude-" + pick_model + "-5-5"
            _r, _u = judge_reqs(items, model)
            res, _, _ = run_batches(_r, model, "redraw-dry-" + pick_model, chunk=60, unmap=_u)
            for cid, j in res.items():
                fig, cf = cid.split("|")
                qa["dry"][fig]["cands"][cf]["judge"] = {"ok": j["ok"], "issues": j["issues"]}
        json.dump(qa, open(qa_path, "w"))
    # decisions: best passing cand (judge ok + ar_ok + ocr_clean), prefer lite-A1, else lite-B1, flash-B1
    order = ["lite-A1.png", "lite-B1.png", "flash-B1.png"]
    dec, ver = [], ["fig\tpick\tcand\tok\tissues\tnote"]
    for fig in figs:
        e = qa["dry"][fig]
        if fig == "r11-8":
            dec.append(f"{fig}\tfixed\tdet\tdeterministic redraw (AI failed)")
            ver.append(f"{fig}\tfixed\tdet\ttrue\t[]\tdeterministic")
            continue
        best = None
        for cf in order:
            c = e["cands"].get(cf)
            if not c:
                continue
            j = c.get("judge", {})
            ok = c.get("ar_ok") and c.get("ocr_clean") and (j.get("ok") if j else True)
            if ok and best is None:
                best = (cf, j.get("issues", []))
        if best:
            dec.append(f"{fig}\tpilot\t{best[0]}\tissues={len(best[1])}")
            ver.append(f"{fig}\tpilot\t{best[0]}\ttrue\t{json.dumps(best[1])}\t")
        else:
            # keep first PASS-minor? no: keep book figure
            dec.append(f"{fig}\tkeep\t-\tno passing candidate, book figure kept")
            ver.append(f"{fig}\tkeep\t-\tfalse\t[]\tno passing candidate")
    open(OUT + "/decisions.tsv", "w").write("\n".join(dec) + "\n")
    open(OUT + "/verdicts.tsv", "w").write("\n".join(ver) + "\n")
    print(f"dry decisions: {sum(1 for d in dec if chr(9)+'pilot' in d)} accepted, "
          f"{sum(1 for d in dec if chr(9)+'keep' in d)} kept, {sum(1 for d in dec if chr(9)+'fixed' in d)} fixed",
          flush=True)
    return qa

def qa_full(pick_model):
    work = json.load(open(DATA + "/work.json"))
    skip = set(json.load(open(DATA + "/skip-scanbg.json")))
    meta = json.load(open(FULL + "/meta-g1.json"))
    uses = json.load(open(DATA + "/uses.json"))
    try:
        ctx = json.load(open(DATA + "/imgs.json"))
    except Exception:
        ctx = {}
    figs = [f for f in work if f not in skip]
    if ONLY:
        figs = [f for f in figs if f in ONLY]
    qa_path = OUT + "/qa.json"
    qa = json.load(open(qa_path)) if os.path.exists(qa_path) and not FRESH else {}
    qa.setdefault("full", {})
    fixed = {"rb-ctc-p0008-1-m1-h1.webp", "rb-ctc-p0852-2-m1-h1.webp", "rb-n2-p024-2-m1-h1.webp",
             "rb-n2-p024-2-m1.webp", "rb-ctc-p0005-2.webp", "rb-ctc-p0006-1.webp",
             "rb-ctc-p0128-1-m1.webp", "rb-ctc-p0678-1.webp", "rb-ctc-p0679-2.webp",
             "rb-ctc-p0855-1.webp", "rb-r11-4-130-8.webp", "rb-r11-4-130-35.webp",
             "rb-r11-4-130-36.webp", "rb-r11-4-130-27.webp", "rb-r11-4-201-11.webp", "rb-n2-p117-1.webp"}
    for f in figs:
        if f in qa["full"] and not FRESH:
            continue
        if f in fixed and f not in meta:
            qa["full"][f] = {"fixed": True}
            continue
        if f in fixed and f in meta:
            qa["full"][f] = {"fixed": True, "note": "fixed art preferred over G1"}
            continue
        if f not in meta:
            qa["full"][f] = {"keep": True, "note": "no batch output"}
            continue
        o = Image.open(DATA + "/media/" + f)
        entry = {"fig": f, "cands": {}}
        for i in ("0", "1"):
            p = f"{FULL}/cand/{f[:-5]}/g1-{i}.png"
            if not os.path.exists(p):
                entry["cands"][i] = {"missing": True}
                continue
            c = Image.open(p)
            ar_ok = abs(c.width / c.height - o.width / o.height) / (o.width / o.height) < 0.03
            ow = ocr_words(p)
            entry["cands"][i] = {"ar_ok": ar_ok, "ocr": (ow or [])[:12] if ow else ow,
                                 "ocr_clean": (ow == []) if ow is not None else None,
                                 "size": list(c.size)}
        qa["full"][f] = entry
        if len(qa["full"]) % 50 == 0:
            json.dump(qa, open(qa_path, "w"))
            print(f"  qa scanned {len(qa['full'])}/{len(figs)}", flush=True)
    json.dump(qa, open(qa_path, "w"))
    if not SKIP_JUDGE and pick_model in ("sonnet", "haiku"):
        model = "claude-" + pick_model + "-5-5"
        items = []
        for f in figs:
            e = qa["full"].get(f, {})
            if e.get("fixed") or e.get("keep"):
                continue
            for i, c in e.get("cands", {}).items():
                if c.get("missing") or "judge" in c:
                    continue
                # skip judge when geometry or OCR already fails (saves $)
                if not c.get("ar_ok") or not c.get("ocr_clean"):
                    c["judge"] = {"ok": False, "issues": ["prefilter"], "skipped": True}
                    continue
                a = ctx.get("media/" + f, ctx.get(f, [{}]))
                a = a[0] if isinstance(a, list) else a
                desc = (a.get("alt", "") + " " + a.get("cap", "")).strip() or f
                items.append((f"{f}|{i}", DATA + "/media/" + f, f"{FULL}/cand/{f[:-5]}/g1-{i}.png", desc))
        print(f"judging {len(items)} prefiltered candidates with {pick_model}", flush=True)
        if items:
            _r, _u = judge_reqs(items, model)
            res, _, _ = run_batches(_r, model, "redraw-g1-" + pick_model, chunk=100, unmap=_u)
            for cid, j in res.items():
                f, i = cid.rsplit("|", 1)
                qa["full"][f]["cands"][i]["judge"] = {"ok": j["ok"], "issues": j["issues"]}
            json.dump(qa, open(qa_path, "w"))
    # OCR on labeled full variants for winners + decisions
    dec, ver = [], ["f\tpick\tjudge_ok\tissues\tuses\tspot_marks\tnote"]
    for f in figs:
        e = qa["full"].get(f, {})
        if e.get("fixed"):
            dec.append(f"{f}\tfixed\tfixed art (pilot/det)")
            ver.append(f"{f}\tfixed\ttrue\t[]\t\t\tfixed art")
            continue
        if e.get("keep"):
            dec.append(f"{f}\tkeep\t{e.get('note', '')}")
            ver.append(f"{f}\tkeep\tfalse\t[]\t\t\t{e.get('note', '')}")
            continue
        u = uses.get(f, [])
        sm = sum(1 for x in u if x.get("spot") or x.get("marks"))
        best = None
        for i in ("0", "1"):
            c = e.get("cands", {}).get(i, {})
            if c.get("missing"):
                continue
            j = c.get("judge", {})
            ok = c.get("ar_ok") and c.get("ocr_clean") and bool(j.get("ok"))
            if ok and best is None:
                best = (i, j.get("issues", []))
        if best:
            # labeled-OCR check on the winner (render full to temp, OCR, compare to our labels)
            art = Image.open(f"{FULL}/cand/{f[:-5]}/g1-{best[0]}.png").convert("RGB")
            lab = render_full(f, art)
            tmp = f"/tmp/fg1-{os.getpid()}.png"
            lab.save(tmp)
            ow = ocr_words(tmp) or []
            try:
                os.remove(tmp)
            except Exception:
                pass
            exp = {norm(t["t"]) for t in texts_full(f)}
            exp_words = set()
            for t in texts_full(f):
                for w in re.split(r"\s+", t["t"]):
                    if norm(w):
                        exp_words.add(norm(w))
            stray = [w for w in ow if norm(w) not in exp_words and len(norm(w)) >= 3]
            if stray:
                ver.append(f"{f}\tkeep\tfalse\t{json.dumps(['stray_ocr:' + ','.join(stray[:6])])}\t{len(u)}\t{sm}\tstray words in labeled art")
                dec.append(f"{f}\tkeep\tstray OCR {','.join(stray[:4])}")
            else:
                dec.append(f"{f}\t{best[0]}\tissues={len(best[1])}")
                ver.append(f"{f}\t{best[0]}\ttrue\t{json.dumps(best[1])}\t{len(u)}\t{sm}\t")
        else:
            reasons = []
            for i in ("0", "1"):
                c = e.get("cands", {}).get(i, {})
                j = c.get("judge", {})
                reasons.append(f"{i}:ar={c.get('ar_ok')},ocr={c.get('ocr_clean')},judge={j.get('ok')}")
            dec.append(f"{f}\tkeep\tno passing candidate ({'; '.join(reasons)})")
            ver.append(f"{f}\tkeep\tfalse\t[]\t{len(u)}\t{sm}\tno passing candidate")
    open(OUT + "/decisions.tsv", "w").write("\n".join(dec) + "\n")
    open(OUT + "/verdicts.tsv", "w").write("\n".join(ver) + "\n")
    n_acc = sum(1 for d in dec if re.match(r"^[^\t]+\t[01]\t", d) or "\tfixed\t" in d)
    print(f"full decisions: {n_acc} accepted, {len(dec) - n_acc} kept", flush=True)
    return qa

if __name__ == "__main__":
    if not OUT:
        sys.exit("need --out DIR")
    if MODE == "bakeoff":
        bakeoff()
    elif MODE == "dry":
        pick = "haiku"
        bp = OUT + "/bakeoff-pick.txt"
        if os.path.exists(bp):
            pick = open(bp).read().strip()
        elif MODEL != "auto":
            pick = MODEL
        else:
            q = bakeoff()
            pick = (q.get("bakeoff_pick") or "haiku")
        print(f"dry with judge={pick}", flush=True)
        qa_pilot(pick)
    elif MODE == "full":
        pick = MODEL if MODEL in ("sonnet", "haiku") else None
        if not pick:
            for cand in [OUT + "/bakeoff-pick.txt", FULL + "/bakeoff-pick.txt"]:
                if os.path.exists(cand):
                    pick = open(cand).read().strip()
                    break
            pick = pick or "haiku"
        print(f"full with judge={pick}", flush=True)
        qa_full(pick)
    else:
        sys.exit("mode bakeoff|dry|full")
