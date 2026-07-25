import io, numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def _png():
    arr = (np.random.rand(256, 256) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()

def test_analyze_free_returns_hf_engine(monkeypatch):
    monkeypatch.setenv("THOREX_MODE", "mock")
    r = client.post("/v1/analyze", files={"file": ("x.png", _png(), "image/png")}, data={"entitlement": "free"})
    assert r.status_code == 200
    assert [e["engine"] for e in r.json()["engines"]] == ["hf_vit"]

def test_analyze_v1_returns_single_engine(monkeypatch):
    monkeypatch.setenv("THOREX_MODE", "mock")
    r = client.post("/v1/analyze", files={"file": ("x.png", _png(), "image/png")}, data={"entitlement": "v1"})
    assert r.status_code == 200
    body = r.json()
    assert body["disclaimer_key"] == "clinical_assist_disclaimer"
    assert [e["engine"] for e in body["engines"]] == ["torchxrayvision"]

def test_analyze_v2beta_returns_both_engines(monkeypatch):
    monkeypatch.setenv("THOREX_MODE", "mock")
    r = client.post("/v1/analyze", files={"file": ("x.png", _png(), "image/png")}, data={"entitlement": "v2beta"})
    body = r.json()
    engines = [e["engine"] for e in body["engines"]]
    assert engines == ["torchxrayvision", "xraydar"]
    xr = next(e for e in body["engines"] if e["engine"] == "xraydar")
    assert xr["educational"] is True and xr["disclaimer_key"] == "educational_not_clinical"

def test_unsupported_type_returns_415():
    r = client.post("/v1/analyze", files={"file": ("x.txt", b"nope", "text/plain")}, data={"entitlement": "v1"})
    assert r.status_code == 415
