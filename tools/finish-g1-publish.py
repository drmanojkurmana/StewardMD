#!/usr/bin/env python3
"""finish-g1-publish.py: publish the redraw stage in waves of ~100 via tools/prep-redraw.mjs publish.
Waves split map.json by figure; each wave runs publish (live re-download, r+1), then SHA-verifies
every uploaded file over the live API. After all waves: prep-ids publish --yes + verify, deid audit.
Usage: finish-g1-publish.py --stage DIR [--waves 100] [--dry] [--repo DIR] [--fresh]"""
import json, os, sys, subprocess, hashlib

def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d

STAGE = os.path.expanduser(arg("--stage"))
WAVES = int(arg("--waves", "100"))
DRY = "--dry" in sys.argv
REPO = os.path.expanduser(arg("--repo", os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FRESH = "--fresh" in sys.argv
API = "https://stewardmd.in/api/prep/bank/"

def sha(b):
    return hashlib.sha256(b).hexdigest()

def get_bytes(key):
    import urllib.request
    r = urllib.request.Request(API + key, headers={"User-Agent": "Mozilla/5.0 finish-g1"})
    with urllib.request.urlopen(r, timeout=60) as u:
        return u.read()

def main():
    MAP = json.load(open(STAGE + "/map.json"))
    figs = sorted(MAP)
    chunks = [figs[i:i + WAVES] for i in range(0, len(figs), WAVES)]
    print(f"publish: {len(figs)} figs in {len(chunks)} waves of <={WAVES}", flush=True)
    done_path = STAGE + "/.publish-done"
    done = set(open(done_path).read().split()) if os.path.exists(done_path) and not FRESH else set()
    pilot = DRY and not any(f.endswith(".webp") for f in figs)
    if pilot:
        print("dry pilot map (fig IDs, not lesson images): skipping prep-redraw publish, "
              "validating stage webps only", flush=True)
        bad = 0
        for f in figs:
            for k in (MAP[f].get("full"), MAP[f].get("hidden")):
                if not k:
                    continue
                p = f"{STAGE}/v1/lessons/media/{k}"
                if not os.path.exists(p) or os.path.getsize(p) == 0:
                    print(f"  MISSING {k}", flush=True)
                    bad += 1
        if bad:
            sys.exit(f"dry stage validation: {bad} missing")
        print(f"dry stage ok: {len(figs)} figs", flush=True)
    for wi, ch in enumerate(chunks, 1):
        if pilot:
            done.add(str(wi))
            continue
        if str(wi) in done and not FRESH:
            print(f"wave {wi}: already done, skipping", flush=True)
            continue
        wmap = STAGE + f"/wave-{wi}-map.json"
        json.dump({f: MAP[f] for f in ch}, open(wmap, "w"), sort_keys=True)
        cmd = ["node", REPO + "/tools/prep-redraw.mjs", "publish", "--stage", STAGE, "--map", wmap]
        if DRY:
            cmd.append("--dry")
        print(f"wave {wi}: {' '.join(cmd)}", flush=True)
        r = subprocess.run(cmd)
        if r.returncode != 0:
            sys.exit(f"wave {wi} publish failed")
        if not DRY:
            # SHA-verify every uploaded file over the live API
            bump = json.load(open(STAGE + "/bump.json"))
            fails = 0
            for f in ch:
                for k in (MAP[f].get("full"), MAP[f].get("hidden")):
                    if not k:
                        continue
                    local = open(f"{STAGE}/v1/lessons/media/{k}", "rb").read()
                    try:
                        remote = get_bytes("v1/lessons/media/" + k)
                    except Exception as e:
                        print(f"  MISSING {k}: {e}", flush=True)
                        fails += 1
                        continue
                    if sha(local) != sha(remote):
                        print(f"  SHA MISMATCH {k}", flush=True)
                        fails += 1
            for lid, rev in bump.items():
                local = open(f"{STAGE}/v{rev}/lessons/{lid}.json", "rb").read()
                try:
                    remote = get_bytes(f"v{rev}/lessons/{lid}.json")
                except Exception as e:
                    print(f"  MISSING lesson {lid}: {e}", flush=True)
                    fails += 1
                    continue
                if sha(local) != sha(remote):
                    print(f"  SHA MISMATCH lesson {lid}", flush=True)
                    fails += 1
            if fails:
                sys.exit(f"wave {wi}: {fails} SHA failures")
            print(f"wave {wi}: SHA-verified {len(ch)} figs", flush=True)
        done.add(str(wi))
        open(done_path, "w").write(" ".join(sorted(done, key=int)) + "\n")
    if pilot:
        open(done_path, "w").write(" ".join(sorted(done, key=int)) + "\n")
    if DRY:
        # dry: verify live (no uploads), never prep-ids publish
        for c in [["node", REPO + "/tools/prep-redraw.mjs", "verify", "--map", STAGE + "/map.json"],
                  ["node", REPO + "/tools/prep-ids.mjs", "verify"],
                  ["node", REPO + "/tools/prep-deid-audit.mjs"]]:
            print("+ " + " ".join(c), flush=True)
            r = subprocess.run(c)
            if r.returncode != 0:
                print(f"WARNING: {' '.join(c[:3])} exited {r.returncode} (live check)", flush=True)
        return
    for c in [["node", REPO + "/tools/prep-ids.mjs", "publish", "--yes"],
              ["node", REPO + "/tools/prep-ids.mjs", "verify"],
              ["node", REPO + "/tools/prep-deid-audit.mjs"]]:
        print("+ " + " ".join(c), flush=True)
        r = subprocess.run(c)
        if r.returncode != 0:
            sys.exit(f"{' '.join(c[:3])} failed")
    print("publish complete", flush=True)

if __name__ == "__main__":
    if not STAGE:
        sys.exit("need --stage DIR")
    main()
