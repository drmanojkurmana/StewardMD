#!/usr/bin/env python3
"""Retrofit scenes in batches with muse (real organ art, visible treatment effect, caption), then measure with quality.mjs and
verify.mjs, commit the scenes that pass and revert the ones that do not. Never pushes.
  python3 tools/figures/dev/retrofit-queue.py <scene=id ...>  (MUSE_MODEL, --batch N)"""
import subprocess, os, sys, time, json
REPO = os.path.expanduser("~/Developer/StewardMD"); TMP = os.environ.get("CLAUDE_JOB_DIR", "/tmp") + "/tmp"; HOME = os.path.expanduser("~")
ENV = dict(os.environ, PATH=HOME + "/.local/bin:" + os.environ["PATH"], ANATOMY_DIR=HOME + "/anatomy", ANIMA_DIR=HOME + "/anima", CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
LOG = HOME + "/Documents/figure-run.log"; MODEL = os.environ.get("MUSE_MODEL", "muse-spark-1.3")
TRAILER = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_018vzZP5z3vJ8JzeSHLXJLU7"
def log(m): open(LOG, "a").write(time.strftime("%H:%M:%S ") + m + "\n")
def sh(c): return subprocess.run(c, shell=True, cwd=REPO, env=ENV, capture_output=True, text=True)
args = sys.argv[1:]; B = int(args[args.index("--batch") + 1]) if "--batch" in args else 6
pairs = [a.split("=") for a in args if "=" in a]
tpl = open(REPO + "/tools/figures/dev/briefs/retrofit.md").read()
for i in range(0, len(pairs), B):
    batch = pairs[i:i + B]; procs = []
    for sc, fid in batch:
        pf = f"{TMP}/rt-{sc}.md"; open(pf, "w").write(tpl.replace("{SCENE}", sc).replace("{ID}", fid))
        procs.append(subprocess.Popen(["muse", "exec", "--trust-workspace", "--workspace", REPO, "--prompt-file", pf, "--approval-mode", "never", "--user-input-auto-resolve", "--model", MODEL,
            "--contributor-mode", "on", "--reasoning-effort", "xhigh"], cwd=REPO, env=ENV, stdout=open(f"{TMP}/rt-{sc}.log", "w"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL))
    t0 = time.time()
    for p in procs:
        try: p.wait(timeout=max(60, 50 * 60 - (time.time() - t0)))
        except subprocess.TimeoutExpired: p.kill()
    ids = [f for _, f in batch]
    v = {l.split()[0]: l for l in sh("node tools/figures/dev/verify.mjs " + " ".join(ids)).stdout.splitlines() if l.strip()}
    q = {l.split("\t")[0]: l.split("\t") for l in sh("node tools/figures/dev/quality.mjs " + " ".join(ids)).stdout.splitlines() if "\t" in l}
    good, bad = [], []
    for sc, fid in batch:
        ok = fid in v and v[fid].split(None, 1)[1].startswith(("ok", "warn")) and fid in q and q[fid][1] != "ERR"
        (good if ok else bad).append((sc, fid))
    for sc, fid in bad:
        sh(f"git checkout -- tools/figures/scenes/{sc}.mjs tools/figures/scenes/{sc}.page.js prep/figures/{fid}.html prep/figures/{fid}-light.html")
    if good:
        paths = " ".join([f"tools/figures/scenes/{s}.mjs tools/figures/scenes/{s}.page.js prep/figures/{f}.html prep/figures/{f}-light.html" for s, f in good])
        sh("git add " + paths)
        mf = TMP + "/rt-msg.txt"; open(mf, "w").write("Figures: real organ art, visible treatment effect and caption: " + ", ".join(f for _, f in good) + "\n\n" + TRAILER + "\n")
        r = sh("git commit -q -F " + mf)
        log(f"retrofit committed {len(good)}: " + ", ".join(f"{f}({q[f][1]}%)" for _, f in good) + ("" if r.returncode == 0 else " COMMIT FAILED"))
    if bad: log("retrofit reverted: " + ", ".join(f for _, f in bad))
log("retrofit queue finished")
