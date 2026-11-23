# ResearchMD Phase 3 worker container (Cloudflare Containers, D-3).
# Build context is backend/research (wrangler image_build_context), NOT this
# directory: the Dockerfile COPYs requirements.txt, app/ and worker/ from the
# service root.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/srv/research/worker

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/research

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY worker ./worker

RUN useradd --uid 10001 --create-home research
USER 10001

EXPOSE 8080
CMD ["uvicorn", "research_worker.app:app", "--host", "0.0.0.0", "--port", "8080"]