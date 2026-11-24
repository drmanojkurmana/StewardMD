"""Extraction: text, words, tables, rotation, OCR flag, ceilings, cancel."""
from __future__ import annotations

import hashlib
import shutil

import pytest

from research_worker.extract import (
    CancelledError,
    CeilingError,
    ExtractError,
    extract_pdf,
)
from conftest import image_only_pdf, rotated_pdf, table_pdf, text_pdf

TESSERACT = shutil.which("tesseract") is not None


def test_text_page_words_and_provenance():
    data = text_pdf()
    result = extract_pdf(data)
    assert result["sha256"] == hashlib.sha256(data).hexdigest()
    assert result["ocr"] is False
    assert len(result["pages"]) == 1
    page = result["pages"][0]
    assert page["n"] == 1
    assert page["width"] == pytest.approx(595.28, abs=0.1)
    assert page["height"] == pytest.approx(841.89, abs=0.1)
    assert "Hello research world page1" in page["text"]
    texts = [w["t"] for w in page["words"]]
    assert "Hello" in texts and "page1" in texts
    for w in page["words"]:
        assert 0 <= w["x0"] <= w["x1"] <= page["width"] + 1
        assert 0 <= w["y0"] <= w["y1"] <= page["height"] + 1
    assert page["ocr"] is False


def test_multi_page_numbers():
    result = extract_pdf(text_pdf(pages=3))
    assert [p["n"] for p in result["pages"]] == [1, 2, 3]
    assert "page3" in result["pages"][2]["text"]


def test_table_extraction():
    result = extract_pdf(table_pdf())
    tables = result["pages"][0]["tables"]
    assert len(tables) == 1
    table = tables[0]
    assert len(table["bbox"]) == 4
    flat = [cell for row in table["rows"] for cell in row if cell]
    assert "Arm" in flat and "100" in flat and "20" in flat
    assert len(table["rows"]) == 3


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotation_keeps_words_and_bounds(rotation):
    data = rotated_pdf(text_pdf(), rotation)
    result = extract_pdf(data)
    page = result["pages"][0]
    texts = [w["t"] for w in page["words"]]
    assert "Hello" in texts and "page1" in texts and "Second" in texts
    assert "Hello research world page1" in page["text"]
    for w in page["words"]:
        assert 0 <= w["x0"] <= w["x1"] <= page["width"] + 1
        assert 0 <= w["y0"] <= w["y1"] <= page["height"] + 1
    if rotation in (90, 270):
        assert page["width"] > page["height"]  # display dimensions swapped


@pytest.mark.skipif(not TESSERACT, reason="tesseract not installed locally")
def test_ocr_flag_on_image_only_page():
    result = extract_pdf(image_only_pdf())
    assert result["ocr"] is True
    page = result["pages"][0]
    assert page["ocr"] is True
    assert page["words"], "OCR produced no words"
    assert "OCR" in page["text"].upper()
    for w in page["words"]:
        assert 0 <= w["x0"] <= w["x1"] <= page["width"] + 1
        assert 0 <= w["y0"] <= w["y1"] <= page["height"] + 1


def test_page_ceiling():
    with pytest.raises(CeilingError) as exc:
        extract_pdf(text_pdf(pages=2), max_pages=1)
    assert exc.value.code == "ceiling_pages"


def test_byte_ceiling():
    with pytest.raises(CeilingError) as exc:
        extract_pdf(text_pdf(), max_bytes=10)
    assert exc.value.code == "ceiling_bytes"


def test_seconds_ceiling():
    with pytest.raises(CeilingError) as exc:
        extract_pdf(text_pdf(), max_seconds=0)
    assert exc.value.code == "ceiling_seconds"


def test_cancel_between_pages():
    seen = []

    def cancel_check():
        # called before the loop and before each page: cancel before page 2
        if len(seen) >= 1:
            raise CancelledError()

    def on_page(n):
        seen.append(n)

    with pytest.raises(CancelledError):
        extract_pdf(text_pdf(pages=3), cancel_check=cancel_check, on_page=on_page)
    assert seen == [1]


def test_unreadable_pdf():
    with pytest.raises(ExtractError) as exc:
        extract_pdf(b"this is not a pdf")
    assert exc.value.code == "pdf_unreadable"