#!/usr/bin/env python3
"""scripts/abdm-capture.py — poll the ABDM callback capture endpoint and turn it into evidence.

ABDM posts its callbacks to whatever base URL is registered on our bridge. While that base is a capture
endpoint (webhook.site, RequestBin, anything that records), this reads what ACTUALLY arrived and writes a
normalised fixture the tests can pin.

The point is to stop inferring. Every `// INFERRED` comment in hip-handlers.js / hiu-handlers.js is a
shape we reasoned our way to; each one this replaces is a shape we have seen.

Usage:
  ./scripts/abdm-capture.py <webhook-token>            # dump everything captured so far
  ./scripts/abdm-capture.py <webhook-token> --watch    # poll until interrupted, printing new arrivals
  ./scripts/abdm-capture.py <webhook-token> --out test/connect/abdm/fixtures/real-callbacks.mjs

The token is the last path segment of the registered URL:
  ./scripts/abdm-sandbox-probe.sh bridge   # shows the URL

NO PHI IS WRITTEN BY DEFAULT. A real callback carries a live ABHA address and patient demographics, so
`--out` redacts them unless you pass --raw, which you should only do into a gitignored path.
"""
import argparse, json, re, sys, time, urllib.request

API = "https://webhook.site/token/%s/requests?sorting=oldest&per_page=100"

# What a captured body must never carry into a committed fixture.
ABHA_ADDR = re.compile(r"\b[A-Za-z0-9._-]+@(?:sbx|abdm)\b")
ABHA_NUM = re.compile(r"\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b")
MOBILE = re.compile(r"\b[6-9]\d{9}\b")
AADHAAR = re.compile(r"\b\d{12}\b")


def redact(node):
    """Structure is the evidence; the identifiers are not. Keep every key and type, mask the values."""
    if isinstance(node, dict):
        return {k: redact(v) for k, v in node.items()}
    if isinstance(node, list):
        return [redact(v) for v in node]
    if isinstance(node, str):
        s = ABHA_ADDR.sub("<abha-address>", node)
        s = ABHA_NUM.sub("<abha-number>", s)
        s = MOBILE.sub("<mobile>", s)
        s = AADHAAR.sub("<aadhaar>", s)
        return s
    return node


def fetch(token):
    req = urllib.request.Request(API % token, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def normalise(it, token):
    body = it.get("content") or ""
    try:
        parsed = json.loads(body) if body else None
    except Exception:
        parsed = None
    hdrs = {k.lower(): (v[0] if isinstance(v, list) else v) for k, v in (it.get("headers") or {}).items()}
    return {
        "at": it.get("created_at"),
        "method": it.get("method"),
        # ABDM appends its own path to our registered base; that path IS the callback identity.
        "path": "/" + it.get("url", "").split(token, 1)[-1].lstrip("/").split("?")[0],
        "headers": {k.upper(): hdrs.get(k) for k in
                    ("request-id", "timestamp", "x-hip-id", "x-hiu-id", "x-cm-id", "content-type") if hdrs.get(k)},
        "hasBearer": bool(hdrs.get("authorization")),
        "body": parsed if parsed is not None else body[:4000],
    }


def emit(records, path, raw):
    payload = records if raw else redact(records)
    with open(path, "w") as f:
        f.write("// test/connect/abdm/fixtures/real-callbacks.mjs — ABDM callbacks AS ACTUALLY RECEIVED.\n")
        f.write("//\n// Captured by scripts/abdm-capture.py from the registered bridge URL. These are not inferred\n")
        f.write("// shapes: every field below arrived from dev.abdm.gov.in. Identifiers are masked; the STRUCTURE\n")
        f.write("// is the evidence, and the structure is untouched.\n//\n")
        f.write("// Regenerate: ./scripts/abdm-capture.py <token> --out %s\n\n" % path)
        f.write("export const REAL_CALLBACKS = Object.freeze(%s);\n\n" % json.dumps(payload, indent=1))
        f.write("/** Every callback path we have actually observed, in arrival order. */\n")
        f.write("export const OBSERVED_PATHS = Object.freeze(%s);\n" % json.dumps([r["path"] for r in payload], indent=1))
    print("wrote %s (%d callbacks%s)" % (path, len(payload), "" if raw else ", identifiers masked"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("token")
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--raw", action="store_true", help="do NOT mask identifiers (gitignored paths only)")
    a = ap.parse_args()

    seen, records = set(), []
    while True:
        try:
            data = fetch(a.token)
        except Exception as e:
            print("poll failed: %s" % e, file=sys.stderr)
            if not a.watch:
                return 1
            time.sleep(5)
            continue
        for it in data.get("data", []):
            if it.get("uuid") in seen:
                continue
            seen.add(it.get("uuid"))
            rec = normalise(it, a.token)
            records.append(rec)
            print("\n" + "=" * 88)
            print(rec["at"], rec["method"], rec["path"], "| bearer:", rec["hasBearer"])
            print("headers:", json.dumps(rec["headers"]))
            print(json.dumps(redact(rec["body"]), indent=1)[:3000])
        if not a.watch:
            break
        time.sleep(4)

    if not records:
        print("nothing captured yet. Trigger a flow, then re-run.")
    if a.out:
        emit(records, a.out, a.raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
