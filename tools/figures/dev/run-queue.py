#!/usr/bin/env python3
"""Build animated scenes from a queue, unattended: launch muse in batches, verify, register and commit the clean ones.

  python3 tools/figures/dev/run-queue.py <queue.tsv> [--batch 8] [--target-scenes 209] [--log <file>]

Queue line: scene|figure-id|effort|topic text.  Per batch: write one prompt per scene (the AGENT-BRIEF plus house rules), run
`muse exec` for each in parallel, wait, run verify.mjs, give a failing scene one repair run, register the passing ones in
prep/figures/figures.json, run the registry and font tests, and commit on the current branch. Never pushes. Waits out a muse
quota (429) and relaunches the scenes that produced nothing. Stops at --target-scenes registered scenes or when the queue is empty."""
import json, os, re, subprocess, sys, time, glob

REPO = os.path.expanduser("~/Developer/StewardMD")
HOME = os.path.expanduser("~")
TMP = os.environ.get("CLAUDE_JOB_DIR", HOME + "/.claude/jobs/run-queue") + "/tmp"
os.makedirs(TMP, exist_ok=True)
ENV = dict(os.environ, PATH=HOME + "/.local/bin:" + os.environ["PATH"], ANATOMY_DIR=HOME + "/anatomy", ANIMA_DIR=HOME + "/anima",
           CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
args = sys.argv[1:]
queue_file = args[0]
batch_n = int(args[args.index("--batch") + 1]) if "--batch" in args else 8
target = int(args[args.index("--target-scenes") + 1]) if "--target-scenes" in args else 209
logf = args[args.index("--log") + 1] if "--log" in args else HOME + "/Documents/figure-run.log"
TRAILER = ("Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n"
           "Claude-Session: https://claude.ai/code/session_018vzZP5z3vJ8JzeSHLXJLU7")
RULES = ("NOTE: your sandbox blocks screenshots and local servers, so do NOT run shot.mjs or sweep.mjs. Check layout by careful coordinate reasoning: "
         "label pills must not overlap each other, shapes, axis labels, node captions or panel/title text; keep pill text short; keep every particle inside the stage; "
         "give every node a visible fill. Typography: never set font-family or use any monospace; all text inherits the figure's clean system sans from the shared CSS. "
         "Any lookup table used by modelOf MUST be declared inside modelOf (it is serialised into the page and cannot see outer variables). "
         "Pool items expose their element as p.e (not p.g). Run --print-model, node --check, termcheck. "
         "Do NOT declare a top-level identifier named stop, start, loop or frame in the page script. The orchestrator will screenshot afterwards.")

def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    with open(logf, "a") as f: f.write(line + "\n")

def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, cwd=REPO, env=ENV, capture_output=True, text=True, **kw)

def registry():
    return json.load(open(REPO + "/prep/figures/figures.json"))["figures"]

def scene_count():
    return sum(1 for f in registry() if f.get("scene"))

def hint(topic):
    lead = topic.split("(")[0].strip()
    r = sh(f'cd {HOME}/harrison-work && uv run --with pymupdf python -I hints.py "{lead}" 2>/dev/null')
    m = re.search(r"-> Harrison '([^']+)' p(\d+): (.*)", r.stdout)
    if not m: return ""
    words = {w for w in re.findall(r"[a-z]{5,}", lead.lower())}
    if not any(w[:5] in m.group(1).lower() for w in words): return ""
    return "Harrison reference concepts (keywords only, so the scene covers the mechanism steps a standard textbook stresses): " + m.group(3)[:300]

def write_prompt(scene, fid, topic):
    p = f"{TMP}/q-{scene}.md"
    open(p, "w").write(
        f"Working directory: {REPO}. First read tools/figures/dev/AGENT-BRIEF.md and follow it, plus tools/figures/scenes/sepsis.mjs and sepsis.page.js as the pattern.\n"
        f"Build ONE scene: scene name `{scene}`, figure id `{fid}`, topic: {topic}\n{hint(topic)}\n"
        "Original drawing from the mechanism, inspired by standard textbook teaching but never copying any figure. "
        "Run node commands with: export ANATOMY_DIR=$HOME/anatomy ANIMA_DIR=$HOME/anima\n" + RULES + "\n"
        f"Rules: create only scenes/{scene}.*, specs/{fid}.json, generated prep/figures/{fid}*.html. No register.sh, no git add/commit/push, no other files. "
        "No doses or numbers, no em or en dashes, flagged AI-assisted for review.\nFinish with a short report: files, termcheck counts, known issues.\n")
    return p

def launch(prompt, effort, name):
    out = open(f"{TMP}/q-{name}.log", "w")
    return subprocess.Popen(["muse", "exec", "--trust-workspace", "--workspace", REPO, "--prompt-file", prompt, "--approval-mode", "never",
                             "--user-input-auto-resolve", "--model", "muse-wonder-1.0", "--contributor-mode", "on", "--reasoning-effort", effort],
                            cwd=REPO, env=ENV, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)

def wait_all(procs, limit=45 * 60):
    t0 = time.time()
    while any(p.poll() is None for p in procs.values()):
        if time.time() - t0 > limit:
            for p in procs.values():
                if p.poll() is None: p.kill()
            log("batch timed out, killed stragglers")
            break
        time.sleep(15)

def quota_hit(names):
    for n in names:
        try:
            if "Subscription quota exhausted" in open(f"{TMP}/q-{n}.log").read(): return True
        except OSError: pass
    return False

def built(scene):
    return os.path.exists(f"{REPO}/tools/figures/scenes/{scene}.reg.json")

def verify(ids):
    r = sh("node tools/figures/dev/verify.mjs " + " ".join(ids))
    res = {}
    for line in r.stdout.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2: res[parts[0]] = parts[1]
    return res

def commit(scenes, ids):
    reg = registry(); have = {f["id"] for f in reg}
    for s in scenes:
        e = json.load(open(f"{REPO}/tools/figures/scenes/{s}.reg.json"))
        if e["id"] not in have: reg.append(e)
    json.dump({**json.load(open(REPO + "/prep/figures/figures.json")), "figures": reg}, open(REPO + "/prep/figures/figures.json", "w"), indent=1, ensure_ascii=False)
    t = sh("node --test --experimental-test-module-mocks --experimental-sqlite test/fig-registry.test.mjs test/fig-fonts.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'")
    log("tests: " + " ".join(t.stdout.split()))
    paths = ["prep/figures/figures.json"] + [f"prep/figures/{i}.html" for i in ids] + [f"prep/figures/{i}-light.html" for i in ids] + \
            [f"tools/figures/specs/{i}.json" for i in ids] + [f"tools/figures/scenes/{s}.{x}" for s in scenes for x in ("mjs", "page.js", "reg.json")]
    sh("git add " + " ".join(paths))
    msg = "Figures: " + ", ".join(ids) + "\n\n" + TRAILER
    r = sh("git commit -q -m " + json.dumps(msg))
    log(("committed " if r.returncode == 0 else "COMMIT FAILED ") + f"{len(ids)} scenes: {', '.join(ids)}" + ("" if r.returncode == 0 else " " + r.stderr[:200]))

queue = []
for line in open(queue_file):
    p = line.rstrip("\n").split("|", 3)
    if len(p) == 4: queue.append(p)
done_ids = {f["id"] for f in registry()}
queue = [q for q in queue if q[1] not in done_ids and not built(q[0])]
log(f"queue {len(queue)} scenes, scenes registered {scene_count()}, target {target}")
failed = []
while queue and scene_count() < target:
    batch = queue[:batch_n]; queue = queue[batch_n:]
    names = [b[0] for b in batch]
    for attempt in range(6):
        todo = [b for b in batch if not built(b[0])]
        if not todo: break
        procs = {b[0]: launch(write_prompt(b[0], b[1], b[3]), b[2], b[0]) for b in todo}
        log(f"launched {len(procs)}: {', '.join(procs)} (attempt {attempt + 1})")
        wait_all(procs)
        if quota_hit([b[0] for b in todo if not built(b[0])]):
            log("muse quota exhausted, sleeping 25 min"); time.sleep(25 * 60)
    ok = [b for b in batch if built(b[0])]
    if not ok: failed += names; continue
    res = verify([b[1] for b in ok])
    bad = [b for b in ok if res.get(b[1], "").startswith("ERROR") or b[1] not in res]
    if bad:
        procs = {}
        for b in bad:
            p = f"{TMP}/q-fix-{b[0]}.md"
            open(p, "w").write(f"Working directory: {REPO}. Fix the scene `{b[0]}` (tools/figures/scenes/{b[0]}.mjs and {b[0]}.page.js, figure id {b[1]}). "
                               f"Loading prep/figures/{b[1]}.html throws: {res.get(b[1], 'page missing or not generated')}. Find the cause in the scene code, fix it, regenerate with "
                               f"`export ANATOMY_DIR=$HOME/anatomy ANIMA_DIR=$HOME/anima; node tools/figures/scenes/{b[0]}.mjs`, run node --check. Edit only the scene's own files and generated pages. No git. {RULES}\n")
            procs[b[0]] = launch(p, "medium", "fix-" + b[0])
        wait_all(procs)
        res.update(verify([b[1] for b in bad]))
    good = [b for b in ok if not res.get(b[1], "ERROR").startswith("ERROR")]
    failed += [b[0] for b in ok if b not in good]
    if good: commit([b[0] for b in good], [b[1] for b in good])
    log(f"batch done: {len(good)} committed, scenes registered {scene_count()}, queue left {len(queue)}")
log(f"finished: scenes registered {scene_count()}, failed or skipped: {failed}")
