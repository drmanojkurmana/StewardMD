"""Loader for the Rust PDF reader (backend/research/rust-pdf, libresearch_pdf.so).

The same reader runs in the app as WebAssembly (vendor/rust-pdf), so the phone
and this container read a PDF's text layer the same way.

Where the library is looked for, in order: $RESEARCH_PDF_LIB, the container
path /usr/local/lib/libresearch_pdf.so (worker/Dockerfile builds it), and the
crate's own release build (`cargo build --release` in backend/research/rust-pdf).
"""
from __future__ import annotations

import ctypes
import json
import os
from pathlib import Path

_HERE = Path(__file__).resolve()
CANDIDATES = [
    os.environ.get("RESEARCH_PDF_LIB") or "",
    "/usr/local/lib/libresearch_pdf.so",
    str(_HERE.parents[2] / "rust-pdf" / "target" / "release" / "libresearch_pdf.so"),
]

_lib = None


class RustPdfUnavailable(RuntimeError):
    """libresearch_pdf.so was not found or could not be loaded."""


def _load():
    global _lib
    if _lib is not None:
        return _lib
    for path in CANDIDATES:
        if path and os.path.isfile(path):
            lib = ctypes.CDLL(path)
            lib.rs_alloc.argtypes = [ctypes.c_size_t]
            lib.rs_alloc.restype = ctypes.c_void_p
            lib.rs_free.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
            lib.rs_free.restype = None
            lib.rs_run_limits.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
            lib.rs_run_limits.restype = ctypes.c_void_p
            lib.rs_result_len.argtypes = []
            lib.rs_result_len.restype = ctypes.c_size_t
            _lib = lib
            return lib
    raise RustPdfUnavailable("libresearch_pdf.so not found")


def read_pdf(data: bytes, *, max_pages: int, max_bytes: int) -> dict:
    """Run the reader. Returns its JSON: {pages, ocr, sha256[, needs_ocr]},
    {"error": code} for a ceiling, or {"unsupported": reason}."""
    lib = _load()
    n = len(data)
    buf = lib.rs_alloc(n)
    if n:
        ctypes.memmove(buf, data, n)
    out = lib.rs_run_limits(buf, n, max_pages, max_bytes)  # frees buf
    size = lib.rs_result_len()
    try:
        raw = ctypes.string_at(out, size)
    finally:
        lib.rs_free(out, size)
    return json.loads(raw.decode("utf-8"))
