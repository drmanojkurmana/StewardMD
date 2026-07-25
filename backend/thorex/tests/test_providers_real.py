import io, numpy as np, pytest
from PIL import Image
from app.pipeline import preprocess

@pytest.mark.models
def test_torchxrayvision_real_inference():
    from app.providers.torchxrayvision_provider import TorchXRayVisionProvider
    arr = (np.random.rand(256, 256) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    prepared = preprocess.prepare(buf.getvalue(), "x.png")
    out = TorchXRayVisionProvider().detect(prepared)
    assert len(out) >= 14
    assert all(0.0 <= p <= 1.0 for _, p in out)
    assert any(lbl == "Pneumonia" for lbl, _ in out) or any("Effusion" in lbl for lbl, _ in out)


@pytest.mark.models
def test_xraydar_real_inference():
    from app.providers.xraydar_provider import XRaydarProvider, key_match_info

    arr = (np.random.rand(600, 600) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    prepared = preprocess.prepare(buf.getvalue(), "x.png")
    p = XRaydarProvider()
    assert p.educational is True
    out = p.detect(prepared)
    assert len(out) >= 10
    assert all(0.0 <= pr <= 1.0 for _, pr in out)
    # Honest verification: the real is512 checkpoint must have loaded into
    # the vendored Inception3 with a high key-match fraction, not near-zero
    # (which would mean the architecture is wrong and outputs are noise).
    info = key_match_info()
    assert info is not None
    assert info["matched_fraction"] >= 0.9
