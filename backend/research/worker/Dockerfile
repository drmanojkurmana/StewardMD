# ResearchMD worker container (Cloudflare Containers, D-3).
# Build context is backend/research (wrangler image_build_context), NOT this
# directory: the Dockerfile COPYs requirements.txt and the service packages
# from the service root. stats/ (5D stats_model) and manuscript/ +
# paperorchestra/ (5A manuscript_draft) ship so every registered kind runs.

# The Rust PDF reader (rust-pdf/), loaded by research_worker/rust_pdf.py. The
# app runs the same code as WebAssembly (vendor/rust-pdf).
FROM rust:1.97-slim-bookworm AS rustpdf
WORKDIR /src
COPY rust-pdf/Cargo.toml rust-pdf/Cargo.lock ./
COPY rust-pdf/.cargo ./.cargo
COPY rust-pdf/src ./src
COPY rust-pdf/examples ./examples
RUN cargo build --release --locked --lib

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/srv/research/worker:/srv/research

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/research

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=rustpdf /src/target/release/libresearch_pdf.so /usr/local/lib/libresearch_pdf.so

COPY app ./app
COPY worker ./worker
COPY stats ./stats
COPY manuscript ./manuscript
COPY paperorchestra ./paperorchestra

RUN useradd --uid 10001 --create-home research
USER 10001

EXPOSE 8080
CMD ["uvicorn", "research_worker.app:app", "--host", "0.0.0.0", "--port", "8080"]