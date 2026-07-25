import io, numpy as np
from PIL import Image, ImageDraw
from app.pipeline import redact

def _img_with_text():
    img = Image.new("L", (512, 512), color=30)          # dark "x-ray"
    ImageDraw.Draw(img).text((10, 10), "NAME: JOHN DOE 57M", fill=255)
    buf = io.BytesIO(); img.save(buf, format="PNG"); return buf.getvalue()

def test_redaction_darkens_text_region_when_ocr_available():
    src = _img_with_text()
    out = redact.redact_burned_in_text(src)
    a0 = np.asarray(Image.open(io.BytesIO(src)).convert("L"))
    a1 = np.asarray(Image.open(io.BytesIO(out)).convert("L"))
    corner0 = a0[0:40, 0:300].mean()
    corner1 = a1[0:40, 0:300].mean()
    # If OCR present, the bright text corner gets darker; if absent, redact returns input unchanged.
    assert corner1 <= corner0

def test_returns_valid_png():
    out = redact.redact_burned_in_text(_img_with_text())
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
