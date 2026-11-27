"""Shared fixtures for the Phase 3 worker tests.

Fixture PDFs are generated here with fpdf2 (dev dependency); no binaries are
committed. Rotation fixtures use pypdf to set /Rotate on a generated page.
"""
from __future__ import annotations

import hashlib
import io

import httpx
from fpdf import FPDF
from pypdf import PdfReader, PdfWriter

from research_worker.queue import Message


def pytest_configure(config):
    """Build the Rust PDF reader (rust-pdf/) the worker loads, when it is not built yet.
    CI runners and dev machines have cargo; the container builds it in worker/Dockerfile."""
    import os
    import shutil
    import subprocess
    from pathlib import Path

    from research_worker import rust_pdf

    if any(p and os.path.isfile(p) for p in rust_pdf.CANDIDATES):
        return
    crate = Path(__file__).resolve().parents[1] / "rust-pdf"
    if shutil.which("cargo"):
        subprocess.run(["cargo", "build", "--release", "--lib", "--manifest-path", str(crate / "Cargo.toml")],
                       check=True)


def text_pdf(pages: int = 1, line: str = "Hello research world") -> bytes:
    pdf = FPDF()
    for p in range(pages):
        pdf.add_page()
        pdf.set_font("Helvetica", size=12)
        pdf.text(72, 72, f"{line} page{p + 1}")
        pdf.text(72, 92, "Second line of text")
    return bytes(pdf.output())


def table_pdf() -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=10)
    pdf.text(72, 40, "Table 1")
    pdf.set_xy(72, 60)
    with pdf.table() as table:
        for row in (("Arm", "N", "Events"), ("A", "100", "12"), ("B", "100", "20")):
            r = table.row()
            for cell in row:
                r.cell(cell)
    return bytes(pdf.output())


def rotated_pdf(raw: bytes, rotation: int) -> bytes:
    writer = PdfWriter()
    reader = PdfReader(io.BytesIO(raw))
    page = reader.pages[0]
    page.rotation = rotation
    writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def image_only_pdf() -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1000, 300), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=48)
    except TypeError:  # Pillow < 10.1
        font = ImageFont.load_default()
    draw.text((40, 100), "OCR MARKER 42", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    pdf = FPDF()
    pdf.add_page()
    pdf.image(buf, x=20, y=40, w=170)
    return bytes(pdf.output())


def make_msg(pdf_bytes: bytes, project: str = "p1", job: str = "job_1", key: str = "k1",
             max_pages: int = 60, max_seconds: int = 240) -> dict:
    sha = hashlib.sha256(pdf_bytes).hexdigest()
    return {
        "v": 1,
        "jobId": job,
        "kind": "pdf_extract",
        "projectId": project,
        "idempotencyKey": key,
        "input": {"r2Key": f"projects/{project}/pdf/{sha}.pdf"},
        "ceilings": {"maxPages": max_pages, "maxSeconds": max_seconds},
        "createdAt": 1763900000,
    }


class FakeStorage:
    """Dict-backed R2 stand-in. cancel_after makes the cancel object appear
    after N exists() calls on the cancel key (mid-document cancel)."""

    def __init__(self, objects: dict | None = None, cancel_after: int | None = None):
        self.objects = dict(objects or {})
        self.reads: list[str] = []
        self.writes: list[str] = []
        self.exists_calls: dict[str, int] = {}
        self.cancel_after = cancel_after

    def get_bytes(self, key):
        self.reads.append(key)
        return self.objects.get(key)

    def exists(self, key):
        count = self.exists_calls.get(key, 0) + 1
        self.exists_calls[key] = count
        if key.endswith("/cancel") and self.cancel_after is not None:
            return count >= self.cancel_after
        return key in self.objects

    def put_bytes(self, key, data, content_type="application/json"):
        self.writes.append(key)
        self.objects[key] = data

    def delete(self, key):
        self.objects.pop(key, None)


class FakeQueue:
    def __init__(self, messages: list[Message]):
        self.messages = messages
        self.acked: list[str] = []
        self.retried: list[tuple[str, int]] = []
        self.pull_args: dict | None = None

    def pull(self, batch_size=5, visibility_timeout_ms=900_000):
        self.pull_args = {"batch_size": batch_size, "visibility_timeout_ms": visibility_timeout_ms}
        return self.messages

    def ack(self, lease_ids):
        self.acked.extend(lease_ids)

    def retry(self, lease_id, delay_seconds=0):
        self.retried.append((lease_id, delay_seconds))

    def close(self):
        pass


def callback_client(statuses: list[int] | None = None):
    """httpx client whose callback endpoint returns the given statuses in
    order (default 200). Returns (client, recorded_requests)."""
    remaining = list(statuses or [])
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        status = remaining.pop(0) if remaining else 200
        return httpx.Response(status, json={"ok": status < 300})

    return httpx.Client(transport=httpx.MockTransport(handler)), calls