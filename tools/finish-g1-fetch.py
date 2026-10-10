#!/usr/bin/env python3
"""finish-g1-fetch.py: stream the G1 Vertex batch jsonl from GCS, decode, unpad to the source frame.
Resumable: skips FULL/cand/<base>/g1-<i>.png that already exist. Keeps no local jsonl copy.
Usage: finish-g1-fetch.py [--full DIR] [--job g1] [--prefix gs://.../batch/g1/out/] [--fresh]"""
import json, os, sys, io, base64, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image

def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d

FULL = os.path.expanduser(arg("--full", os.environ.get("REDRAW_FULL", "~/prep-data/rad/redraw/full")))
JOB = arg("--job", "g1")
FRESH = "--fresh" in sys.argv
PREFIX = arg("--prefix", "gs://project-6074a703-e86c-40a5-848-prep-batch/private/redraw/batch/g1/out/")

def token():
    return subprocess.check_output(["gcloud", "auth", "application-default", "print-access-token"],
                                   stderr=subprocess.DEVNULL).decode().strip()

def gcs_list(prefix):
    # prefix gs://bucket/path/ -> [(bucket, name)] for *.jsonl via Storage JSON API
    assert prefix.startswith("gs://")
    rest = prefix[5:]
    b, _, p = rest.partition("/")
    import urllib.request, urllib.parse
    t = token()
    out, page = [], None
    while True:
        q = urllib.parse.urlencode({"prefix": p, "pageToken": page} if page else {"prefix": p})
        r = urllib.request.Request(f"https://storage.googleapis.com/storage/v1/b/{b}/o?{q}",
                                   headers={"Authorization": "Bearer " + t})
        j = json.load(urllib.request.urlopen(r, timeout=60))
        for it in j.get("items", []):
            if it["name"].endswith(".jsonl"):
                out.append((b, it["name"]))
        page = j.get("nextPageToken")
        if not page:
            return out

def gcs_cat(b, name):
    import urllib.request
    t = token()
    r = urllib.request.Request(f"https://storage.googleapis.com/storage/v1/b/{b}/o/{urllib.parse.quote(name, safe='')}"
                               "?alt=media", headers={"Authorization": "Bearer " + t})
    return urllib.request.urlopen(r, timeout=300)

def gsutil_cat(uri):
    p = subprocess.Popen(["gsutil", "-q", "cat", uri], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return p.stdout

def main():
    meta = json.load(open(f"{FULL}/meta-{JOB}.json"))
    job = json.load(open(f"{FULL}/job-{JOB}.json"))
    print(f"fetch {JOB}: {len(meta)} figs, job {job['job']}", flush=True)
    # locate jsonl: prefer Vertex outputInfo, fall back to prefix listing
    uris = []
    try:
        import urllib.request
        t = token()
        r = urllib.request.Request(f"https://aiplatform.googleapis.com/v1/{job['job']}",
                                   headers={"Authorization": "Bearer " + t,
                                            "x-goog-user-project": "project-6074a703-e86c-40a5-848"})
        j = json.load(urllib.request.urlopen(r, timeout=60))
        d = (j.get("outputInfo") or {}).get("gcsOutputDirectory", "")
        if d:
            uris += [f"gs://{b}/{n}" for b, n in gcs_list(d if d.endswith("/") else d + "/")]
    except Exception as e:
        print(f"vertex lookup failed ({str(e)[:100]}), using prefix", flush=True)
    if not uris:
        try:
            uris = [f"gs://{b}/{n}" for b, n in gcs_list(PREFIX)]
        except Exception as e:
            print(f"gcs list failed: {e}", flush=True)
    if not uris:
        # last resort: single predictions.jsonl under the prefix
        uris = [PREFIX.rstrip("/") + "/predictions.jsonl"]
    ok = bad = skip = 0
    for uri in uris:
        print(f"streaming {uri}", flush=True)
        try:
            fh = gsutil_cat(uri)
            # gsutil may be broken; if it yields nothing in 10s, fall back to API
            import select
            use_api = False
            if hasattr(fh, "fileno"):
                try:
                    r, _, _ = select.select([fh], [], [], 10)
                    if not r:
                        use_api = True
                except Exception:
                    pass
            if use_api or fh is None:
                raise RuntimeError("gsutil stalled")
            stream, is_popen = fh, True
        except Exception:
            rest = uri[5:]
            b, _, n = rest.partition("/")
            stream, is_popen = gcs_cat(b, n), False
        buf = b""
        nlines = 0
        while True:
            chunk = stream.read(1 << 20)
            if not chunk:
                break
            buf += chunk
            *lines, buf = buf.split(b"\n")
            for ln in lines:
                if not ln.strip():
                    continue
                nlines += 1
                try:
                    o = json.loads(ln)
                except Exception:
                    bad += 1
                    continue
                key = o.get("key", "")
                if "|" not in key:
                    continue
                f, i = key.rsplit("|", 1)
                m = meta.get(f)
                if not m:
                    continue
                d = f"{FULL}/cand/{f[:-5]}"
                p = f"{d}/{JOB}-{i}.png"
                if os.path.exists(p) and os.path.getsize(p) > 0 and not FRESH:
                    skip += 1
                    continue
                resp = o.get("response") or {}
                data = None
                for c in resp.get("candidates", [])[:1]:
                    for pt in c.get("content", {}).get("parts", []):
                        if "inlineData" in pt:
                            data = base64.b64decode(pt["inlineData"]["data"])
                if not data:
                    bad += 1
                    continue
                try:
                    g = Image.open(io.BytesIO(data)).convert("RGB")
                    sx, sy = g.width / m["CW"], g.height / m["CH"]
                    crop = g.crop((round(m["ox"] * sx), round(m["oy"] * sy),
                                   round((m["ox"] + m["W"]) * sx), round((m["oy"] + m["H"]) * sy)))
                    os.makedirs(d, exist_ok=True)
                    crop.save(p)
                    ok += 1
                except Exception:
                    bad += 1
                if (ok + bad + skip) % 100 == 0:
                    print(f"  {ok} ok, {bad} noimage, {skip} skipped ({nlines} lines)", flush=True)
        if buf.strip():
            try:
                o = json.loads(buf)
                key = o.get("key", "")
                if "|" in key:
                    print("  (trailing line ignored, rerun to finish)", flush=True)
            except Exception:
                pass
        if is_popen:
            try:
                stream.close()
            except Exception:
                pass
    print(f"fetch done: {ok} ok, {bad} noimage, {skip} skipped")
    open(f"{FULL}/.fetch-{JOB}-done", "w").write(f"{ok} {bad} {skip}\n")

if __name__ == "__main__":
    main()
