"""PDF extraction with page provenance (Phase 3.2).

Output shape (contract worker-runtime.md / retention.md result.json payload):
  {pages: [{n, width, height, text, words: [{t, x0, y0, x1, y1}],
            tables: [{bbox, rows}], ocr}], ocr: bool, sha256}

Coordinates are pdfplumber points in DISPLAY space (top-left origin, y down),
so they line up with what pdf.js renders in the app, /Rotate included.

Rotation: pdfplumber swaps page dimensions for /Rotate but its positional
word sorting reverses char order at 180/270. For rotated pages we rebuild
words from chars in content order, using the text matrix origin (e, f) and
advance direction (a, b), which are rotation-consistent. Verified at 0, 90,
180 and 270 degrees.

OCR: pages with no text layer are rasterised (pypdfium2 via pdfplumber,
honours /Rotate) and read with Tesseract. Ceilings and the cancel flag are
checked between pages and before OCR.
"""
from __future__ import annotations

import hashlib
import io
import math
import shutil
import time

import pdfplumber
import pytesseract

DEFAULT_MAX_PAGES = 60
DEFAULT_MAX_SECONDS = 240
DEFAULT_MAX_BYTES = 25 * 1024 * 1024  # 26,214,400
OCR_RESOLUTION = 200


class CeilingError(Exception):
    """A ceilings.md limit was hit. code is the stable callback error code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class CancelledError(Exception):
    """The R2 cancel object appeared while the job was running."""


class ExtractError(Exception):
    """Extraction failed for a non-ceiling reason (stable code, no PHI)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _check_cancel(cancel_check):
    if cancel_check is not None:
        cancel_check()


def _check_time(deadline: float):
    if time.monotonic() > deadline:
        raise CeilingError("ceiling_seconds")


def _round_box(x0, y0, x1, y1) -> dict:
    return {"x0": round(x0, 2), "y0": round(y0, 2), "x1": round(x1, 2), "y1": round(y1, 2)}


def _words_from_chars(chars: list[dict]) -> list[tuple[dict, dict]]:
    """Group chars into words in content order. Returns (word, first_char).

    A word break happens when the next char origin is more than 0.25 em
    beyond the previous char's advance along the text direction, or more
    than 0.5 em perpendicular to it. Distances use the text matrix, so the
    rule is identical at every page rotation.
    """
    groups: list[list[dict]] = []
    cur: list[dict] = []
    for ch in chars:
        text = ch.get("text") or ""
        if not text or text.isspace():
            if cur:
                groups.append(cur)
                cur = []
            continue
        if cur:
            prev = cur[-1]
            m = prev["matrix"]
            norm = math.hypot(m[0], m[1]) or 1.0
            ux, uy = m[0] / norm, m[1] / norm
            expected_x = m[4] + prev["adv"] * ux
            expected_y = m[5] + prev["adv"] * uy
            cm = ch["matrix"]
            dx, dy = cm[4] - expected_x, cm[5] - expected_y
            along = dx * ux + dy * uy
            perp = abs(-dx * uy + dy * ux)
            if along > 0.25 * prev["size"] or perp > 0.5 * prev["size"]:
                groups.append(cur)
                cur = []
        cur.append(ch)
    if cur:
        groups.append(cur)

    out = []
    for group in groups:
        word = {"t": "".join(c["text"] for c in group)}
        word.update(
            _round_box(
                min(c["x0"] for c in group),
                min(c["top"] for c in group),
                max(c["x1"] for c in group),
                max(c["bottom"] for c in group),
            )
        )
        out.append((word, group[0]))
    return out


def _text_from_words(pairs: list[tuple[dict, dict]]) -> str:
    """Assemble lines for rotated pages: words whose baselines share a
    perpendicular projection belong to one line, in content order."""
    lines: list[list[str]] = []
    cur_key = None
    cur_size = 12.0
    for word, first in pairs:
        m = first["matrix"]
        norm = math.hypot(m[0], m[1]) or 1.0
        ux, uy = m[0] / norm, m[1] / norm
        key = -m[4] * uy + m[5] * ux
        if cur_key is None or abs(key - cur_key) <= 0.5 * cur_size:
            if not lines:
                lines.append([])
            lines[-1].append(word["t"])
        else:
            lines.append([word["t"]])
        cur_key, cur_size = key, first["size"]
    return "\n".join(" ".join(line) for line in lines)


def _tables(page) -> list[dict]:
    out = []
    try:
        found = page.find_tables()
    except Exception:
        return out
    for table in found:
        rows = table.extract()
        out.append({"bbox": [round(v, 2) for v in table.bbox], "rows": rows})
    return out


def _ocr_page(page, deadline: float, cancel_check) -> tuple[list[dict], str]:
    if shutil.which("tesseract") is None:
        raise ExtractError("ocr_unavailable")
    _check_time(deadline)
    image = page.to_image(resolution=OCR_RESOLUTION).original
    _check_cancel(cancel_check)
    _check_time(deadline)
    try:
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    except pytesseract.TesseractError as exc:
        raise ExtractError("ocr_failed") from exc
    scale_x = page.width / image.width
    scale_y = page.height / image.height
    words = []
    lines: dict[tuple, list[str]] = {}
    count = len(data.get("text") or [])
    for i in range(count):
        text = (data["text"][i] or "").strip()
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if not text or conf < 0:
            continue
        x0 = data["left"][i] * scale_x
        y0 = data["top"][i] * scale_y
        word = {"t": text}
        word.update(
            _round_box(x0, y0, x0 + data["width"][i] * scale_x, y0 + data["height"][i] * scale_y)
        )
        words.append(word)
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(text)
    text = "\n".join(" ".join(parts) for parts in lines.values())
    return words, text


def _extract_page(page, deadline: float, cancel_check) -> dict:
    chars = page.chars
    has_text_layer = any((c.get("text") or "").strip() for c in chars)
    rotation = (page.rotation or 0) % 360
    if has_text_layer:
        if rotation == 0:
            words = [
                dict({"t": w["text"]}, **_round_box(w["x0"], w["top"], w["x1"], w["bottom"]))
                for w in page.extract_words()
            ]
            text = page.extract_text() or ""
        else:
            pairs = _words_from_chars(chars)
            words = [word for word, _ in pairs]
            text = _text_from_words(pairs)
        tables = _tables(page)
        ocr = False
    else:
        words, text = _ocr_page(page, deadline, cancel_check)
        tables = []
        ocr = True
    return {
        "n": page.page_number,
        "width": round(float(page.width), 2),
        "height": round(float(page.height), 2),
        "text": text,
        "words": words,
        "tables": tables,
        "ocr": ocr,
    }


def extract_pdf(
    data: bytes,
    *,
    max_pages: int = DEFAULT_MAX_PAGES,
    max_seconds: int = DEFAULT_MAX_SECONDS,
    max_bytes: int = DEFAULT_MAX_BYTES,
    cancel_check=None,
    on_page=None,
) -> dict:
    """Extract one PDF within the ceilings.md limits.

    cancel_check: callable invoked between pages; raises CancelledError.
    on_page: callable invoked with the 1-based page number after each page,
    so the caller can report partial usage on failure.
    """
    start = time.monotonic()
    deadline = start + max_seconds
    sha256 = hashlib.sha256(data).hexdigest()
    if len(data) > max_bytes:
        raise CeilingError("ceiling_bytes")
    _check_cancel(cancel_check)
    _check_time(deadline)
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception as exc:
        raise ExtractError("pdf_unreadable") from exc
    pages = []
    any_ocr = False
    try:
        if len(pdf.pages) > max_pages:
            raise CeilingError("ceiling_pages")
        for page in pdf.pages:
            _check_cancel(cancel_check)
            _check_time(deadline)
            extracted = _extract_page(page, deadline, cancel_check)
            any_ocr = any_ocr or extracted["ocr"]
            pages.append(extracted)
            if on_page is not None:
                on_page(extracted["n"])
        _check_time(deadline)
    finally:
        pdf.close()
    return {"pages": pages, "ocr": any_ocr, "sha256": sha256}