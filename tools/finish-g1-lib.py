#!/usr/bin/env python3
"""finish-g1-lib.py: shared paths, ledger and Anthropic Batch client for the G1 finish pipeline."""
import json, os, sys, time, urllib.request, urllib.error

DATA = os.path.expanduser(os.environ.get("REDRAW_DATA", "~/prep-data/rad/redraw"))
FULL = os.environ.get("REDRAW_FULL", DATA + "/full")
REVIEW = os.environ.get("REDRAW_REVIEW", DATA + "/review")
LEDGER = os.environ.get("SPEND_LEDGER", os.path.expanduser("~/prep-data/assessment/spend-ledger.tsv"))

# Batch $/M tokens, derived 2026-10-10 from spend-ledger.tsv (M3 key-screen rows, no cache).
PRICE = {"claude-haiku-5-5": (0.031, 0.25), "claude-sonnet-5-5": (0.86, 4.52)}

def cost(model, i, o):
    pi, po = PRICE.get(model, PRICE["claude-haiku-5-5"])
    return i * pi / 1e6 + o * po / 1e6

def ledger_append(job, model, i, o, note, path=None):
    p = path or LEDGER
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        new = not os.path.exists(p)
        with open(p, "a") as f:
            if new:
                f.write("date\tjob\tmodel\tinput_tokens\toutput_tokens\tcost_usd\tnote\n")
            f.write(f"{time.strftime('%Y-%m-%d')}\t{job}\t{model}\t{i}\t{o}\t{cost(model,i,o):.4f}\t{note}\n")
    except OSError as e:
        print(f"ledger append failed ({p}): {e}", file=sys.stderr)

def anth_env():
    k = os.environ.get("ANTHROPIC_API_KEY")
    w = os.environ.get("ANTHROPIC_WORKSPACE_ID")
    if not k:
        p = os.path.expanduser("~/.config/stewardmd/anthropic.env")
        if os.path.exists(p):
            for l in open(p):
                l = l.strip()
                if l.startswith("ANTHROPIC_API_KEY="):
                    k = l.split("=", 1)[1].strip().strip("'\"")
                elif l.startswith("ANTHROPIC_WORKSPACE_ID="):
                    w = l.split("=", 1)[1].strip().strip("'\"")
    if not k:
        raise RuntimeError("ANTHROPIC_API_KEY not set (and no ~/.config/stewardmd/anthropic.env)")
    return k, w

def _req(method, url, body=None):
    k, w = anth_env()
    h = {"x-api-key": k, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
    if w:
        h["anthropic-workspace-id"] = w
    r = urllib.request.Request(url, json.dumps(body).encode() if body else None, h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=120) as u:
            return json.load(u) if "results" not in url else u.read().decode()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"anthropic {e.code} {e.read().decode()[:400]}")

def batch_submit(requests):
    return _req("POST", "https://api.anthropic.com/v1/messages/batches", {"requests": requests})

def batch_get(bid):
    return _req("GET", f"https://api.anthropic.com/v1/messages/batches/{bid}")

def batch_results(bid):
    txt = _req("GET", f"https://api.anthropic.com/v1/messages/batches/{bid}/results")
    out = {}
    for l in txt.splitlines():
        if l.strip():
            o = json.loads(l)
            out[o["custom_id"]] = o
    return out

def batch_wait(bid, poll=60, timeout=4 * 3600):
    t0 = time.time()
    while True:
        j = batch_get(bid)
        s = j.get("processing_status")
        if s == "ended":
            return j
        if time.time() - t0 > timeout:
            raise RuntimeError(f"batch {bid} still {s} after {timeout}s")
        time.sleep(poll)
