"""Phase 6D — upload validation + rate limiting. Pure Python (no ML deps)."""
from __future__ import annotations

import pytest

from app.core.errors import BadImage
from app.core.ratelimit import TokenBucket
from app.core.upload import sniff_mime, validate_image_bytes

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 16


class _S:
    max_upload_bytes = 1024


def test_sniff_known_formats():
    assert sniff_mime(PNG) == "image/png"
    assert sniff_mime(JPEG) == "image/jpeg"
    assert sniff_mime(WEBP) == "image/webp"
    assert sniff_mime(b"ftypheic") is None            # too short
    assert sniff_mime(b"\x00\x00\x00\x18ftypheic....") == "image/heic"


def test_validate_rejects_non_image():
    with pytest.raises(BadImage):
        validate_image_bytes(b"this is not an image at all", _S())


def test_validate_rejects_oversize():
    with pytest.raises(BadImage):
        validate_image_bytes(PNG + b"\x00" * 2048, _S())


def test_validate_rejects_empty():
    with pytest.raises(BadImage):
        validate_image_bytes(b"", _S())


def test_validate_accepts_png():
    assert validate_image_bytes(PNG, _S()) == "image/png"


def test_token_bucket_disabled_allows_all():
    b = TokenBucket()
    assert all(b.allow("k", 0, 5) for _ in range(100))   # rate 0 = disabled


def test_token_bucket_limits_burst():
    b = TokenBucket()
    allowed = sum(1 for _ in range(10) if b.allow("k", 1, 3))  # burst 3, slow refill
    assert allowed == 3
