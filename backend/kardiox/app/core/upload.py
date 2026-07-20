"""Upload validation + image sanitization (Phase 6D security).

Defense-in-depth: the edge Worker validates uploads at ingress, and the pipeline re-validates the bytes
it reads from R2 (never trust that the object is what we expect). `validate_image_bytes` is pure-Python
(size + magic-byte sniff — no decode, so a malicious file can't exploit a decoder here);
`sanitize_to_png` re-decodes + re-encodes to strip EXIF/ICC/metadata and normalize the container.
"""
from __future__ import annotations

from app.core.errors import BadImage

# magic-byte → mime (first bytes of the file)
_MAGIC = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"II*\x00", "image/tiff"),
    (b"MM\x00*", "image/tiff"),
]
_HEIC_BRANDS = (b"heic", b"heix", b"mif1", b"hevc", b"msf1", b"heim", b"heis")


def sniff_mime(data: bytes) -> str | None:
    """Return a mime type from the file's magic bytes, or None if not a recognized image."""
    if not data or len(data) < 12:
        return None
    for magic, mime in _MAGIC:
        if data.startswith(magic):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp" and data[8:12] in _HEIC_BRANDS:
        return "image/heic"
    return None


def validate_image_bytes(data: bytes, settings, content_type: str | None = None) -> str:
    """Validate size + type BEFORE any decode. Raises BadImage. Returns the sniffed mime."""
    if not data:
        raise BadImage("Empty upload", stage="upload")
    if len(data) > settings.max_upload_bytes:
        raise BadImage(f"Upload too large ({len(data)} bytes > {settings.max_upload_bytes})", stage="upload")
    mime = sniff_mime(data)
    if mime is None:
        raise BadImage("Unsupported or corrupt image (not a recognized image format)", stage="upload")
    return mime


def sanitize_to_png(data: bytes) -> bytes:
    """Re-decode + re-encode to PNG, stripping all metadata (EXIF/ICC). Decode failure -> BadImage."""
    try:
        import cv2
        import numpy as np
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("opencv/numpy not installed", stage="upload") from e
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise BadImage("Could not decode image for sanitization", stage="upload")
    ok, enc = cv2.imencode(".png", img)
    if not ok:
        raise BadImage("Image re-encode failed", stage="upload")
    return enc.tobytes()
