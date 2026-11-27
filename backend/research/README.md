# StewardMD Research: Python worker (Phase 3)

PDF extraction worker for ResearchMD. Consumes the `research-jobs` Cloudflare
pull queue from a Cloudflare Container (D-3), writes results to private R2,
and settles jobs with an HMAC-signed callback to the Pages API.

Contracts are frozen in `docs/research/contracts/phase-3/` (job message,
callback, ceilings, PHI gate, retention, worker runtime, threat model).
Builders code to those files.

Deterministic statistics are NOT here: `research-engine.js` is canonical for
univariate meta-analysis (the phone runs it for previews, the Pages Function
imports it for saved runs). The Python meta-analysis endpoint was retired in
Phase 0. Python becomes canonical for regression, survival and diagnostic
models in Phase 5D.

## Layout

- `worker/research_worker/`: the container package.
  - `queue.py`: Queues HTTP pull client (pull, ack, retry).
  - `storage.py`: R2 via the S3 API (boto3).
  - `extract.py`: text, words, tables, page provenance via the Rust reader (`rust-pdf/`, same code the app runs as WebAssembly); Tesseract
    OCR for pages with no text layer; rotation handling; ceilings.
  - `jobs.py`: idempotent runs, cancel checks, HMAC callback, drain loop.
  - `app.py`: FastAPI `GET /health` and token-protected `POST /drain`.
- `worker/Dockerfile`: python:3.12-slim + tesseract-ocr, non-root, port 8080.
  Build context is this directory (`backend/research`), set via wrangler
  `image_build_context`.
- `app/main.py`: legacy entry point, re-exports the worker app.
- `tests/`: pytest suite. Fixture PDFs are generated with fpdf2, not
  committed. OCR tests skip when tesseract is absent.

The cron front door lives in `workers/research-worker/` (Worker + Durable
Object container binding). Nothing deploys from a builder session.

## Run locally

```bash
cd backend/research
uv venv -p 3.12 .venv
uv pip install -p .venv -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m pytest -q
PYTHONPATH=worker .venv/bin/uvicorn research_worker.app:app --port 8080
```

`POST /drain` needs `DRAIN_TOKEN` (header `X-Drain-Token`) plus the queue, R2
and callback env listed in `worker-runtime.md`. Without them it answers 503;
it never runs unauthenticated.

## CI

The Research CI workflow runs pytest with PYTHONPATH set to the service root;
`pytest.ini` adds `worker` to the path. Local equivalent: the commands above.

Do not use for clinical decision-making. Extracted values are unverified
until a human checks them against the source page (plan rule 9).