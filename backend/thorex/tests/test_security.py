"""Task 10: temp-image lifecycle + PHI-safe scrubbed logging.

structlog (see app.core.logging.configure_logging) renders JSON straight to
stdout via structlog's default PrintLogger -- it is NOT routed through the
stdlib `logging` module, so pytest's `caplog` fixture never sees it. We
capture the real emitted log line with `capsys` instead, which reads the
process's actual stdout -- this is what proves no image bytes ever reach a
log sink, not just an empty/irrelevant caplog buffer.
"""
import io
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from app.main import app
from app.services import storage

client = TestClient(app)


def _png():
    arr = (np.random.rand(256, 256) * 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()


def test_temp_image_deleted_after_context():
    with storage.temp_image(b"abc") as p:
        assert p.exists()
        assert p.read_bytes() == b"abc"
    assert not p.exists()


def test_temp_image_deleted_even_on_exception():
    path_ref = {}
    try:
        with storage.temp_image(b"abc") as p:
            path_ref["p"] = p
            assert p.exists()
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    assert not path_ref["p"].exists()


def test_analyze_logs_have_no_image_bytes(monkeypatch, capsys):
    monkeypatch.setenv("THOREX_MODE", "mock")
    data = _png()
    r = client.post(
        "/v1/analyze",
        files={"file": ("x.png", data, "image/png")},
        data={"entitlement": "v1"},
    )
    assert r.status_code == 200

    captured = capsys.readouterr().out
    assert data not in captured.encode() if isinstance(captured, str) else True
    assert "\x89PNG" not in captured
    assert "data:image" not in captured
    # base64 of the raw PNG bytes must never show up either.
    import base64
    assert base64.b64encode(data).decode() not in captured


def test_analyze_logs_contain_expected_scrubbed_fields(monkeypatch, capsys):
    monkeypatch.setenv("THOREX_MODE", "mock")
    data = _png()
    r = client.post(
        "/v1/analyze",
        files={"file": ("x.png", data, "image/png")},
        data={"entitlement": "v1"},
    )
    assert r.status_code == 200
    body = r.json()

    captured = capsys.readouterr().out
    assert '"event": "analyzed"' in captured
    assert body["request_id"] in captured
    assert '"entitlement": "v1"' in captured
    assert '"phash"' in captured
    assert '"n_findings"' in captured
    assert '"ms"' in captured
