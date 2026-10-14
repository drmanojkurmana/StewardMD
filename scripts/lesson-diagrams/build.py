"""python3 scripts/lesson-diagrams/build.py figs_a1 [figs_a2 ...]: draws each figure to prep/lessons/media and wires it
into its lesson step (only a step with vis null, or one already pointing at the same file). Prints layout warnings."""
import sys, json, os, importlib, re, glob, subprocess
sys.path.insert(0, os.path.dirname(__file__))
import lib
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MEDIA = f"{ROOT}/prep/lessons/media"
from reg import REG, NEW

def wj(p, d):
    # write in the file's original style (indent, escapes, trailing newline); origin/main is the reference
    rel = os.path.relpath(p, ROOT)
    head = subprocess.run(["git", "show", "origin/main:" + rel], cwd=ROOT, capture_output=True, text=True).stdout
    ind = 2 if head.startswith('{\n  "') else 1
    esc = bool(re.search(r"\\u[0-9a-fA-F]{4}", head))
    nl = "\n" if head.endswith("\n") else ""
    if head and json.dumps(json.loads(head), indent=ind, ensure_ascii=esc) + nl != head: print("WARN style does not round-trip:", rel)
    open(p, "w").write(json.dumps(d, indent=ind, ensure_ascii=esc) + nl)

def run(mods):
    sheet = []; sheet_ar = []
    for m in mods:
        importlib.import_module(m)
    for lesson, after, tx, say in NEW:
        p = f"{ROOT}/prep/lessons/v1/{lesson}.json"; d = json.load(open(p))
        if not any(s["tx"] == tx for s in d["steps"]):
            d["steps"].insert(after + 1, {"tx": tx, "say": say, "vis": None}); wj(p, d)
    done = 0
    for lesson, step, alt, cap, fn in REG:
        if isinstance(fn, str):
            p = f"{ROOT}/prep/lessons/v1/{lesson}.json"; d = json.load(open(p)); st = d["steps"][step]
            assert not st.get("vis") or re.search(r"/(ana|phy)-", st["vis"].get("src", "")), (lesson, step)
            ar = [x for n, x in sheet_ar if n == fn][0]
            st["vis"] = {"kind": "image", "src": f"prep/lessons/media/{fn}.svg", "alt": alt, "caption": cap, "ar": round(ar, 4)}
            wj(p, d); continue
        lib.CUR[0] = fn.__name__
        f = fn()
        prefix = "ana" if lesson.startswith("ana-") or lesson.startswith("ss-neuro") else "phy"
        f.name = f"{prefix}-{fn.__name__.replace('_', '-')}"
        lib.WARN[:] = [w for w in lib.WARN]
        name, ar = lib.save(f, MEDIA)
        p = f"{ROOT}/prep/lessons/v1/{lesson}.json"
        d = json.load(open(p))
        st = d["steps"][step]
        src = f"prep/lessons/media/{name}.svg"
        assert not st.get("vis") or re.search(r"/(ana|phy)-", st["vis"].get("src", "")), (lesson, step, st.get("vis"))
        for t in (alt, cap): assert "–" not in t and "—" not in t
        st["vis"] = {"kind": "image", "src": src, "alt": alt, "caption": cap, "ar": round(ar, 4)}
        wj(p, d)
        sheet.append((name, f.build())); sheet_ar.append((name, ar)); done += 1
    for w in lib.WARN: print("WARN", w)
    open("/tmp/sheet.html", "w").write("<body style='margin:0;background:#ddd'>" + "".join(f"<div style='display:inline-block;width:49%;margin:4px 0.5%;background:#fff'><div style='font:12px sans-serif'>{n}</div>{s}</div>" for n, s in sheet[int(os.environ.get("SHEETFROM", "0")):] if not os.environ.get("ONLY") or any(o in n for o in os.environ["ONLY"].split(","))))
    if NEW:
        ip = f"{ROOT}/prep/lessons/v1/index.json"; txt = open(ip).read()
        for lesson in {n[0] for n in NEW}:
            n = len(json.load(open(f"{ROOT}/prep/lessons/v1/{lesson}.json"))["steps"])
            txt = re.sub(r'("%s": \{[^}]*?"steps": )\d+' % re.escape(lesson), lambda m: m.group(1) + str(n), txt, count=1)
        open(ip, "w").write(txt)
    keep = {f"{n}.svg" for n, _ in sheet}
    for p in glob.glob(f"{MEDIA}/ana-*.svg") + glob.glob(f"{MEDIA}/phy-*.svg"):
        if os.path.basename(p) not in keep: os.remove(p); print("removed stale", os.path.basename(p))
    print("figures", done, "lessons", len({r[0] for r in REG}))

if __name__ == "__main__":
    run(sys.argv[1:] or sorted(os.path.basename(p)[:-3] for p in glob.glob(os.path.dirname(__file__) + "/figs_*.py")))
