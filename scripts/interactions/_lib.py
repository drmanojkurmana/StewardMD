"""Shared helpers for the StewardMD drug-interaction data pipeline.

Pure-stdlib (urllib) HTTP with an on-disk response cache under build/ so the
pipeline is re-runnable offline once fetched, and polite throttling for the
public NLM/openFDA endpoints. No third-party deps required.
"""
import json
import os
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CURATED = os.path.join(HERE, "curated")
BUILD = os.path.join(HERE, "build")
SCHEMA = os.path.join(HERE, "schema")
os.makedirs(BUILD, exist_ok=True)

RXNAV = "https://rxnav.nlm.nih.gov/REST"
OPENFDA = "https://api.fda.gov/drug/label.json"
OPENFDA_KEY = os.environ.get("OPENFDA_API_KEY", "").strip()

_last = {"t": 0.0}


def _throttle(min_interval):
    dt = time.time() - _last["t"]
    if dt < min_interval:
        time.sleep(min_interval - dt)
    _last["t"] = time.time()


def load_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def curated(name, default=None):
    return load_json(os.path.join(CURATED, name), default)


def _cache_path(tag, key):
    safe = urllib.parse.quote(key, safe="")[:180]
    d = os.path.join(BUILD, "cache", tag)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, safe + ".json")


def http_json(url, tag, key, throttle=0.06, timeout=30, retries=3):
    """GET url -> parsed JSON, cached on disk by (tag,key). Returns None on hard failure."""
    cp = _cache_path(tag, key)
    if os.path.exists(cp):
        try:
            return load_json(cp)
        except Exception:
            pass
    last_err = None
    for attempt in range(retries):
        _throttle(throttle)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "StewardMD-DDI-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            save_json(cp, data)
            return data
        except Exception as e:  # noqa: BLE001 - network/JSON errors are all recoverable here
            last_err = e
            # openFDA returns 404 for "no match" — cache an empty marker, don't retry.
            if "HTTP Error 404" in str(e):
                save_json(cp, {"__notfound": True})
                return {"__notfound": True}
            time.sleep(0.5 * (attempt + 1))
    print(f"  ! fetch failed ({key}): {last_err}")
    return None


def rxnav_url(path, **params):
    q = urllib.parse.urlencode(params)
    return f"{RXNAV}/{path}?{q}" if q else f"{RXNAV}/{path}"


def openfda_url(**params):
    if OPENFDA_KEY:
        params["api_key"] = OPENFDA_KEY
    return f"{OPENFDA}?{urllib.parse.urlencode(params)}"


def norm(s):
    return (s or "").strip().lower()
