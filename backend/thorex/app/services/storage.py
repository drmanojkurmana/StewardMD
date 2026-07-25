"""Temp-file lifecycle for uploaded images.

Writes the raw upload to a private temp file for the duration of a single
request and guarantees deletion afterwards -- including when the request
body raises (unsupported format, inference failure, etc). No image bytes
are logged anywhere in this module.
"""
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


@contextmanager
def temp_image(data: bytes) -> Iterator[Path]:
    fd, name = tempfile.mkstemp(prefix="thorex-", suffix=".img")
    path = Path(name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        yield path
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
