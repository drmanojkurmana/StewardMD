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

def test_perceptual_hash_returns_16_hex_for_valid_png():
    b = _png_bytes()
    h = preprocess.perceptual_hash(b)
    assert len(h) == 16
    int(h, 16)  # must be valid hex

def test_perceptual_hash_unavailable_for_non_image_bytes():
    assert preprocess.perceptual_hash(b"%PDF-1.4 not-an-image") == "unavailable"

def test_pil_from_pdf_with_bad_pdf_raises_unsupported_format():
    import pytest
    with pytest.raises(preprocess.UnsupportedFormat):
        preprocess._pil_from(b"not-a-real-pdf-blob", "x.pdf")

def test_prepare_returns_prepared_image_with_redact_hook_applied():
    from app.providers.base import PreparedImage

    prepared = preprocess.prepare(
        _png_bytes(), "x.png", redact_hook=lambda png: png + b"MARKER"
    )

    assert isinstance(prepared, PreparedImage)
    assert prepared.array.shape == (224, 224)
    assert prepared.array.dtype == np.float32
    assert prepared.outbound_png.endswith(b"MARKER")
    assert prepared.outbound_png.startswith(b"\x89PNG\r\n\x1a\n")
