"""PDF extraction with page provenance (Phase 3.2).

Output shape (contract worker-runtime.md / retention.md result.json payload):
  {pages: [{n, width, height, text, words: [{t, x0, y0, x1, y1}],
            tables: [{bbox, rows}], ocr}], ocr: bool, sha256}

Coordinates are points in DISPLAY space (top-left origin, y down), so they
line up with what pdf.js renders in the app, /Rotate included.

Text layer: the Rust reader (backend/research/rust-pdf, loaded by rust_pdf.py).
It is a value-for-value copy of the old pdfplumber 0.11 reader (words, text,
rotated pages, tables; checked equal on 57 PDFs) and about 30x faster. The app
runs the same reader as WebAssembly, so phone and server read alike.

Files the Rust reader does not copy exactly (vertical writing, predefined CJK
CMaps, a few font encodings) come back "unsupported": those are read with
PyMuPDF instead (words and text, no tables).

OCR: pages with no text layer are rendered with PyMuPDF (honours /Rotate) and
read with Tesseract. Ceilings and the cancel flag are checked between pages
and before OCR.
"""
from __future__ import annotations

import hashlib
import shutil
import time

import pymupdf
import pytesseract

from .rust_pdf import read_pdf

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


def _render(page):
    """Render a PyMuPDF page at OCR_RESOLUTION as a PIL image (rotation applied)."""
    from PIL import Image

    pix = page.get_pixmap(dpi=OCR_RESOLUTION, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def _ocr_page(page, width: float, height: float, deadline: float, cancel_check) -> tuple[list[dict], str]:
    if shutil.which("tesseract") is None:
        raise ExtractError("ocr_unavailable")
    _check_time(deadline)
    image = _render(page)
    _check_cancel(cancel_check)
    _check_time(deadline)
    try:
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    except pytesseract.TesseractError as exc:
        raise ExtractError("ocr_failed") from exc
    scale_x = width / image.width
    scale_y = height / image.height
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


def _mupdf_page(page) -> dict:
    """Words and text for a page the Rust reader left to PyMuPDF (display space, no tables)."""
    rot = page.rotation_matrix
    words = []
    lines: dict[tuple, list[str]] = {}
    for x0, y0, x1, y1, text, block, line, _ in page.get_text("words", sort=False):
        r = pymupdf.Rect(x0, y0, x1, y1) * rot
        words.append(dict({"t": text}, **_round_box(r.x0, r.y0, r.x1, r.y1)))
        lines.setdefault((block, line), []).append(text)
    return {"words": words, "text": "\n".join(" ".join(p) for p in lines.values())}


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
    res = read_pdf(data, max_pages=max_pages, max_bytes=max_bytes)
    if "error" in res:
        raise CeilingError(res["error"])
    rust_pages = None if "unsupported" in res else {p["n"]: p for p in res["pages"]}
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ExtractError("pdf_unreadable") from exc
    pages = []
    any_ocr = False
    try:
        if doc.page_count == 0:
            raise ExtractError("pdf_unreadable")
        if doc.page_count > max_pages:
            raise CeilingError("ceiling_pages")
        for i in range(doc.page_count):
            _check_cancel(cancel_check)
            _check_time(deadline)
            n = i + 1
            rp = rust_pages.get(n) if rust_pages is not None else None
            if rp is not None and not rp.get("needs_ocr"):
                extracted = {k: rp[k] for k in ("n", "width", "height", "text", "words", "tables")}
                extracted["ocr"] = False
            else:
                page = doc[i]
                width = rp["width"] if rp else round(float(page.rect.width), 2)
                height = rp["height"] if rp else round(float(page.rect.height), 2)
                got = None if rp else _mupdf_page(page)
                if got is not None and any(w["t"].strip() for w in got["words"]):
                    extracted = {"n": n, "width": width, "height": height, "text": got["text"],
                                 "words": got["words"], "tables": [], "ocr": False}
                else:
                    words, text = _ocr_page(page, width, height, deadline, cancel_check)
                    extracted = {"n": n, "width": width, "height": height, "text": text,
                                 "words": words, "tables": [], "ocr": True}
            any_ocr = any_ocr or extracted["ocr"]
            pages.append(extracted)
            if on_page is not None:
                on_page(extracted["n"])
        _check_time(deadline)
    finally:
        doc.close()
    return {"pages": pages, "ocr": any_ocr, "sha256": sha256}
