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
