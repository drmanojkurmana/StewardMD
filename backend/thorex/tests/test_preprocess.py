import io, numpy as np
from PIL import Image
from app.pipeline import preprocess

def _png_bytes(w=256, h=256):
    arr = (np.random.rand(h, w) * 255).astype("uint8")
    buf = io.BytesIO(); Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()

def test_load_png_returns_224_normalized():
    out = preprocess.load_image(_png_bytes(), "x.png")
    assert out.shape == (224, 224)
    assert out.dtype == np.float32
    assert out.min() >= -1024.0 and out.max() <= 1024.0

def test_unsupported_format_raises():
    import pytest
    with pytest.raises(preprocess.UnsupportedFormat):
        preprocess.load_image(b"nope", "x.txt")

def test_perceptual_hash_stable():
    b = _png_bytes()
    assert preprocess.perceptual_hash(b) == preprocess.perceptual_hash(b)
