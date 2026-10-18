#!/usr/bin/env python3
"""Write the Mechanism mastery entries for every figure that lacks one, with muse, in parallel chunks.
  python3 tools/figures/dev/mastery-gen.py [--chunk 10] [--parallel 8] [--only id,id]
Per chunk: a context file (title, blurb, drug names, on-figure labels) + a prompt; muse writes prep/figures/mastery-part/<k>.json;
then mastery-merge.mjs validates and merges. Figures still missing after a pass are retried (up to 3 passes). Never commits or pushes."""
import json, os, re, subprocess, sys, time
REPO = os.path.expanduser("~/Developer/StewardMD"); HOME = os.path.expanduser("~")
TMP = os.environ.get("CLAUDE_JOB_DIR", HOME + "/.claude/jobs/mastery") + "/tmp"; os.makedirs(TMP, exist_ok=True)
ENV = dict(os.environ, PATH=HOME + "/.local/bin:" + os.environ["PATH"])
a = sys.argv[1:]; chunk = int(a[a.index("--chunk") + 1]) if "--chunk" in a else 10; par = int(a[a.index("--parallel") + 1]) if "--parallel" in a else 8
only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else None
FRAME = """The mechanism mastery framework (apply it to every figure):
1. Trigger: what starts the process (for example an autoantibody, toxin, gene mutation, infection, physiological demand).
2. Target: which cell, receptor, enzyme or pathway is affected.
3. Mechanism: what happens at the molecular or cellular level.
4. Manifestation: how the mechanism explains the symptoms, signs and investigations.
5. Intervention: which drug or step targets the mechanism; and separately 'adverse': the adverse effects that follow from that drug's own action (for example a beta blocker slowing the heart because it blocks the same receptor)."""
def log(m): print(time.strftime("%H:%M:%S ") + m, flush=True)
def labels(fid):
    try: h = open(f"{REPO}/prep/figures/{fid}.html").read()
    except OSError: return []
    h = h.split("<script")[0]
    seen = []
    for t in re.findall(r">([A-Za-zÀ-ɏ][^<>]{2,44})<", h):
        t = t.strip()
        if t and t not in seen and not re.match(r"(Fig |Tap |Hover|Schematic|Speeds|Pause|Play|Treatment|Anatomy|Anima)", t): seen.append(t)
    return seen[:45]
def missing():
    items = json.load(open(f"{REPO}/prep/figures/mastery.json"))["items"] if os.path.exists(f"{REPO}/prep/figures/mastery.json") else {}
    return [f for f in json.load(open(f"{REPO}/prep/figures/figures.json"))["figures"] if f["id"] not in items and (not only or f["id"] in only)]
def run_pass(k0):
    todo = missing()
    if not todo: return 0
    os.makedirs(f"{REPO}/prep/figures/mastery-part", exist_ok=True)
    chunks = [todo[i:i + chunk] for i in range(0, len(todo), chunk)]
    log(f"pass {k0}: {len(todo)} figures in {len(chunks)} chunks")
    procs = []
    for ci, ch in enumerate(chunks):
        k = f"p{k0}c{ci:02d}"; ctx = f"{TMP}/ms-{k}.json"
        json.dump([{"id": f["id"], "title": f.get("title"), "blurb": f.get("blurb"), "drugs": sorted((f.get("drugs") or {}).keys())[:14], "labels_on_figure": labels(f["id"])} for f in ch], open(ctx, "w"), indent=0)
        pr = f"{TMP}/ms-{k}.md"
        open(pr, "w").write(f"Working directory: {REPO}. Read {ctx} (a JSON list of {len(ch)} interactive medical figures: id, title, blurb, drug names, labels shown on the figure).\n"
            f"{FRAME}\n\nFor EACH figure write one entry. Create the file prep/figures/mastery-part/{k}.json containing one JSON object: {{\"<id>\": {{\"trigger\": \"...\", \"target\": \"...\", \"mechanism\": \"...\", \"manifestation\": \"...\", \"intervention\": \"...\", \"adverse\": \"...\"}}, ...}}.\n"
            "Rules: each field 1 to 2 plain sentences, at most 45 words; mark the 2 to 4 key terms in every field (receptors, enzymes, cell types, drug names, the signs that matter) by wrapping them in **double asterisks**, for example **Th2 cells** or **beta1 receptor**, and use no other markdown; accurate standard teaching consistent with the figure's title and labels; no doses, no lab or dose numbers, no em or en dashes; "
            "write for an MBBS or postgraduate student; for a normal physiology, biochemistry or anatomy figure the trigger is the physiological demand or the defect, and the intervention and adverse fields name the drug or condition that alters this process and what follows from its action; "
            "for a drug-class figure the trigger is the clinical problem the drug treats and the adverse field covers the adverse effects that follow from the mechanism. Do not edit any other file. Finish with a one line report.\n")
        procs.append(subprocess.Popen(["muse", "exec", "--trust-workspace", "--workspace", REPO, "--prompt-file", pr, "--approval-mode", "never", "--user-input-auto-resolve", "--model", os.environ.get("MUSE_MODEL", "muse-wonder-1.0"), "--contributor-mode", "on", "--reasoning-effort", "xhigh" if os.environ.get("MUSE_MODEL", "").startswith("muse-spark") else "medium"],
            cwd=REPO, env=ENV, stdout=open(f"{TMP}/ms-{k}.log", "w"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL))
        while sum(1 for p in procs if p.poll() is None) >= par: time.sleep(10)
    for p in procs:
        while p.poll() is None: time.sleep(10)
    r = subprocess.run("node tools/figures/dev/mastery-merge.mjs", shell=True, cwd=REPO, capture_output=True, text=True); log(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[:200])
    return len(missing())
left = 1
for k0 in range(3):
    left = run_pass(k0)
    if not left: break
log(f"done, figures still without an entry: {left}")
