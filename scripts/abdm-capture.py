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
  ./scripts/abdm-capture.py <webhook-token> --expect m2 --timeout 600   # E2E VERDICT: did M2 complete?
  ./scripts/abdm-capture.py <webhook-token> --expect m3 --timeout 600   # ...and M3

The token is the last path segment of the registered URL:
  ./scripts/abdm-sandbox-probe.sh bridge   # shows the URL

NO PHI IS WRITTEN BY DEFAULT. A real callback carries a live ABHA address and patient demographics, so
`--out` redacts them unless you pass --raw, which you should only do into a gitignored path.
"""
import argparse, json, re, sys, time, urllib.request

API = "https://webhook.site/token/%s/requests?sorting=oldest&per_page=100"

# ---- the M2 / M3 end-to-end expectation sets ------------------------------------------------------
# Each entry is (certification-ish label, path substring). A milestone is COMPLETE only when every
# callback in its set has actually arrived - which is the difference between "we sent the request and got a
# 202" and "the flow worked". `--expect` is the verdict; `flow` is only the trigger.
#
# Paths are matched as substrings of the callback path ABDM appended to our registered base, because that
# path IS the callback's identity (see normalise()).
EXPECT = {
    "m2": [
        ("link token issued (demographic auth)", "/token/on-generate-token"),
        ("care-context discovery", "/patient/care-context/discover"),
        ("link init (OTP issued)", "/link/care-context/init"),
        ("link confirm (OTP verified)", "/link/care-context/confirm"),
        ("scan-and-share", "/patient/share"),
    ],
    "m3": [
        ("consent request accepted", "/consent/request/on-init"),
        ("consent GRANTED notification", "/consent/request/notify"),
        ("consent artefact fetched", "/consent/on-fetch"),
        ("health-information request accepted", "/health-information/hiu/on-request"),
    ],
    # The two the gateway emits without any human tapping in the ABHA app. If even these are missing, the
    # registered callback URL is wrong or expired - check `abdm-sandbox-probe.sh bridge` before anything else.
    "server-driven": [
        ("consent request accepted", "/consent/request/on-init"),
        ("link token issued", "/token/on-generate-token"),
    ],
}


def verdict(records, which):
    """Per-callback PASS/MISSING table for one milestone. Returns True when the milestone is complete."""
    want = EXPECT[which]
    paths = [r["path"] for r in records]
    print("\n" + "=" * 88)
    print("%s END-TO-END - %d callback(s) required" % (which.upper(), len(want)))
    print("=" * 88)
    ok = True
    for label, frag in want:
        hit = next((p for p in paths if frag in p), None)
        print("  %-8s %-42s %s" % ("PASS" if hit else "MISSING", label, hit or frag))
        ok = ok and bool(hit)
    extra = [p for p in paths if not any(f in p for _, f in want)]
    if extra:
        print("\n  also observed (not required for %s): %s" % (which, ", ".join(sorted(set(extra)))))
    print("\n  %s: %s" % (which.upper(), "COMPLETE" if ok else "INCOMPLETE - the MISSING rows above have not arrived"))
    if not ok:
        print("  Patient-initiated steps only fire when someone taps in the Sandbox ABHA app;")
        print("  see docs/connect/abdm/CAPTURE-RUNBOOK.md step 3.")
    return ok

# What a captured body must never carry into a committed fixture.
ABHA_ADDR = re.compile(r"\b[A-Za-z0-9._-]+@(?:sbx|abdm)\b")
ABHA_NUM = re.compile(r"\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b")
MOBILE = re.compile(r"\b[6-9]\d{9}\b")
AADHAAR = re.compile(r"\b\d{12}\b")


# A NAME is PHI and no regex can spot one - "Manoj Kumar Kurmana" is just a string. So names are masked by
# KEY instead. This was a real leak: the discovery callback carries patient.name, the value-regexes below
# passed it straight through, and it would have been committed to a tracked fixture.
NAME_KEYS = {"name", "fullname", "firstname", "middlename", "lastname", "patientname", "healthid", "abhaaddress"}


def redact(node, key=None):
    """Structure is the evidence; the identifiers are not. Keep every key and type, mask the values."""
    if key is not None and str(key).lower() in NAME_KEYS and isinstance(node, str) and node.strip():
        return "<" + str(key).lower() + ">"
    if isinstance(node, dict):
        return {k: redact(v, k) for k, v in node.items()}
    if isinstance(node, list):
        return [redact(v, key) for v in node]
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
    ap.add_argument("--expect", choices=sorted(EXPECT), help="poll until this milestone's callbacks all arrive, then print a verdict")
    ap.add_argument("--timeout", type=int, default=900, help="seconds to wait for --expect (default 900)")
    a = ap.parse_args()
    # --expect implies watching: the patient-initiated callbacks arrive minutes after the trigger.
    if a.expect:
        a.watch = True

    seen, records = set(), []
    started = time.time()
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
        if a.expect:
            want = EXPECT[a.expect]
            paths = [r["path"] for r in records]
            if all(any(f in p for p in paths) for _, f in want):
                verdict(records, a.expect)
                if a.out:
                    emit(records, a.out, a.raw)
                return 0
            if time.time() - started > a.timeout:
                print("\ntimed out after %ds waiting for %s" % (a.timeout, a.expect), file=sys.stderr)
                verdict(records, a.expect)
                if a.out:
                    emit(records, a.out, a.raw)
                return 2
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
