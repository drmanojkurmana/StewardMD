import io

import numpy as np
import pytest
from PIL import Image

from app.providers.xraydar_provider import _INPUT_SIZE, _to_model_input


def _png_bytes(w: int, h: int) -> bytes:
    arr = (np.random.rand(h, w) * 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.parametrize("w, h", [(600, 600), (800, 500), (400, 900)])
def test_to_model_input_shape_from_outbound_png(w, h):
    """_to_model_input must build a [1, 1, 512, 512] tensor straight from a
    full-resolution outbound_png (any aspect ratio), matching the vendored
    single-channel Inception3(in_channels=1) is512 input, without touching
    the shared 224px torchxrayvision-normalized array."""
    png = _png_bytes(w, h)
    t = _to_model_input(png)
    assert t.shape == (1, 1, _INPUT_SIZE, _INPUT_SIZE)
    assert t.dtype.is_floating_point


def test_to_model_input_applies_native_normalize_not_minmax():
    """A near-uniform (constant-ish) source image should NOT produce a
    min-max-rescaled [~-1.8, ~1.8] tensor (the old approximation's typical
    Normalize(0.491, 0.271) range applied to a min-max [0,1] signal); it
    should reflect X-Raydar's own fixed Normalize(mean=0.491, std=0.271)
    applied directly to the [0, 1]-scaled pixel values, so a solid mid-gray
    image maps close to 0 rather than being stretched to span the full
    normalized range."""
    arr = np.full((512, 512), 125, dtype="uint8")  # ~0.49 in [0,1] -> near 0 post-normalize
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    t = _to_model_input(buf.getvalue())
    assert t.abs().max().item() < 0.1
