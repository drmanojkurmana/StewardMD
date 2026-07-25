import io
from PIL import Image, ImageDraw
from app.core.logging import get_logger

log = get_logger("redact")


def redact_burned_in_text(png: bytes, min_conf: int = 60) -> bytes:
    """Best-effort de-identification: black-box OCR-detected text word-boxes.

    This is defense-in-depth on top of consent/disclosure, NOT a guarantee of
    de-identification. If pytesseract can't be imported, or the tesseract
    binary is missing/errors, this logs a warning and returns the input PNG
    unchanged so the analyze pipeline never hard-fails. Only detected text
    boxes are redacted -- never whole-image regions -- so lung fields are
    left untouched.
    """
    try:
        import pytesseract
    except Exception:
        log.warning("ocr_unavailable_redaction_skipped")
        return png
    img = Image.open(io.BytesIO(png)).convert("L")
    try:
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    except Exception as e:  # tesseract binary missing / fails
        log.warning("ocr_failed_redaction_skipped", error=str(e))
        return png
    draw = ImageDraw.Draw(img)
    n = len(data.get("text", []))
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        try:
            conf = int(float(data["conf"][i]))
        except (ValueError, TypeError):
            conf = -1
        if txt and conf >= min_conf:
            x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
            draw.rectangle([x, y, x + w, y + h], fill=0)  # black-box the text
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
