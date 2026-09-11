"""Token comparison must stay constant-time AND survive a hostile header.

secrets.compare_digest (== hmac.compare_digest) raises TypeError on a str holding non-ASCII
characters. HTTP headers decode as latin-1, so one byte >127 in X-Pipeline-Token or X-Admin-Token
made the auth check raise; with no exception handler on this app that is a 500 instead of a 401,
triggerable by an anonymous caller on the admin endpoints.

Run: python3 backend/kardiox-image/test_token_eq.py
"""
import re
import secrets
import sys
import os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")


def load_token_eq():
    """Pull _token_eq out of main.py without importing it (main.py needs torch/timm)."""
    src = open(SRC).read()
    m = re.search(r"def _token_eq.*?\n    return .*?\n", src, re.S)
    assert m, "_token_eq not found in main.py"
    ns = {"secrets": secrets}
    exec(m.group(0), ns)
    return ns["_token_eq"]


def main():
    token_eq = load_token_eq()
    cases = [
        ("exact match", "s3cret", "s3cret", True),
        ("wrong token", "wrong", "s3cret", False),
        ("empty supplied", "", "s3cret", False),
        ("prefix of the secret", "s3c", "s3cret", False),
        ("longer than the secret", "s3cretXX", "s3cret", False),
        ("non-ASCII supplied (used to 500)", "s3cr\xff", "s3cret", False),
        ("non-ASCII in the secret", "abc", "s\xe9cret", False),
        ("non-ASCII on both sides, equal", "\xe9\xe9", "\xe9\xe9", True),
    ]
    failures = 0
    for label, supplied, expected, want in cases:
        try:
            got = token_eq(supplied, expected)
        except Exception as e:  # a raise here is the bug this file exists for
            print("  RAISED   %-34s %s: %s" % (label, type(e).__name__, e))
            failures += 1
            continue
        if got != want:
            print("  MISMATCH %-34s got %r want %r" % (label, got, want))
            failures += 1
        else:
            print("  ok       %-34s -> %r" % (label, got))

    # The construct this replaced, on the same input, for contrast.
    try:
        secrets.compare_digest("s3cr\xff", "s3cret")
        print("\n  note: bare compare_digest did NOT raise here (unexpected)")
    except TypeError as e:
        print("\n  note: bare compare_digest on the same input raises TypeError: %s" % e)

    print("\n%s" % ("FAILED: %d" % failures if failures else "all token comparison cases pass"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
