#!/usr/bin/env python3
"""scripts/abdm-bridge.py — record ABDM callbacks AND let the receiver answer them.

WHY THIS EXISTS. webhook.site records a callback and never replies. The gateway therefore times out,
and every callback that only fires *after* our reply - link/care-context/init, /confirm, the whole
patient-initiated half of M2 - can never be observed. Ten of the fifteen kinds were stuck behind that.

This sits in front of the real receiver instead: it records the raw request, forwards it to
`wrangler pages dev`, and relays the real response back to ABDM. So the flow continues AND we keep the
evidence. It also serves the same JSON shape webhook.site's API returns, so scripts/abdm-capture.py
works against it unchanged (`ABDM_CAPTURE_API=http://127.0.0.1:8787/token/%s/requests`).

Nothing is deployed to do this: the receiver runs on localhost and reaches ABDM through a cloudflared
quick tunnel. Teardown is ctrl-C. See scripts/abdm-local-receiver.sh, which starts all three.

  ./scripts/abdm-bridge.py [--port 8787] [--upstream 127.0.0.1:8788] [--log FILE] [--token local]
"""
import argparse, http.server, json, os, socketserver, threading, urllib.error, urllib.request, uuid
from datetime import datetime, timezone

# Hop-by-hop headers must not be forwarded (RFC 7230 6.1). Host is dropped so the upstream sees its own.
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
       "transfer-encoding", "upgrade", "host", "content-length"}

RECORDS = []
LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def remember(rec, log_path):
    """Append-only: a captured callback is evidence, and evidence that lives only in RAM is not."""
    with LOCK:
        RECORDS.append(rec)
        if log_path:
            with open(log_path, "a") as f:
                f.write(json.dumps(rec) + "\n")


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):  # one tidy line per callback instead of two noisy ones
        pass

    def _capture_api(self):
        """Serve what webhook.site's /token/<t>/requests serves, so abdm-capture.py needs no changes."""
        with LOCK:
            payload = json.dumps({"data": list(RECORDS)}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _proxy(self, method):
        path = self.path
        # The capture API is ours, not ABDM's - never record it, never forward it.
        if method == "GET" and path.startswith("/token/") and "/requests" in path:
            return self._capture_api()

        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n) if n else b""
        hdrs = {k.lower(): v for k, v in self.headers.items()}

        try:
            content = body.decode("utf-8")
        except UnicodeDecodeError:
            content = "<%d non-utf8 bytes>" % len(body)

        rec = {
            "uuid": str(uuid.uuid4()),
            "created_at": now_iso(),
            "method": method,
            # capture.py derives the callback path by splitting on the token, so the token must be in here.
            "url": "http://bridge/%s%s" % (ARGS.token, path),
            "headers": {k: [v] for k, v in hdrs.items()},
            "content": content,
        }

        fwd = urllib.request.Request(
            "http://%s%s" % (ARGS.upstream, path), method=method,
            data=body if body else None,
            headers={k: v for k, v in self.headers.items() if k.lower() not in HOP},
        )
        try:
            with urllib.request.urlopen(fwd, timeout=ARGS.timeout) as r:
                status, rbody, rhdrs = r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:          # the receiver's own 4xx - a real answer, relay it
            status, rbody, rhdrs = e.code, e.read(), dict(e.headers)
        except Exception as e:
            # The receiver is down or wedged. Still record: what arrived is the evidence either way.
            status, rbody, rhdrs = 502, json.dumps({"error": "bridge_upstream", "detail": str(e)}).encode(), {}
            rec["bridgeError"] = str(e)

        rec["upstreamStatus"] = status
        remember(rec, ARGS.log)
        print("%s  %-4s %-52s -> %s" % (rec["created_at"], method, path[:52], status), flush=True)

        self.send_response(status)
        for k, v in rhdrs.items():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header("content-length", str(len(rbody)))
        self.end_headers()
        self.wfile.write(rbody)

    def do_POST(self):   self._proxy("POST")
    def do_GET(self):    self._proxy("GET")
    def do_PUT(self):    self._proxy("PUT")
    def do_PATCH(self):  self._proxy("PATCH")
    def do_DELETE(self): self._proxy("DELETE")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--upstream", default="127.0.0.1:8788")
    ap.add_argument("--log", default=os.environ.get("ABDM_BRIDGE_LOG", ""))
    ap.add_argument("--token", default="local", help="stands in for the webhook.site token in recorded URLs")
    ap.add_argument("--timeout", type=int, default=30)
    ARGS = ap.parse_args()

    # Survive a restart: a callback captured an hour ago is still evidence.
    if ARGS.log and os.path.exists(ARGS.log):
        with open(ARGS.log) as f:
            for line in f:
                try:
                    RECORDS.append(json.loads(line))
                except Exception:
                    pass
        print("reloaded %d record(s) from %s" % (len(RECORDS), ARGS.log), flush=True)

    print("bridge on :%d -> %s   capture API: /token/%s/requests" % (ARGS.port, ARGS.upstream, ARGS.token), flush=True)
    Server(("0.0.0.0", ARGS.port), Handler).serve_forever()
