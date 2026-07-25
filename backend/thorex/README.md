# ThoreX AI — Chest X-Ray Inference Backend

FastAPI service that analyzes a chest X-ray (or CT-style single image) and
returns entitlement-gated, banded findings — never raw probabilities — plus
Grad-CAM localization and a mandatory clinical disclaimer. It backs the
StewardMD ThoreX feature (frontend + admin/entitlement wiring are separate
plans; see "Scope" below).

## Scope of this service (Phase 1 backend slice)

This repo implements only the inference microservice:

- Multi-format image ingestion (PNG/JPEG/HEIC/PDF) with perceptual-hash
  dedup, EXIF strip, and format-safe preprocessing.
- An image-quality gate (exposure/rotation/cropping heuristics; `view` may
  be reported as `unknown`).
- Three swappable inference engines behind one `InferenceProvider`
  interface: a free-tier hosted-inference engine (HF), a primary detector
  (TorchXRayVision), and an educational-only engine (X-Raydar).
- Best-effort OCR-based redaction of burned-in PHI text on the image before
  any bytes leave the process (e.g. before a free-tier network call).
- Grad-CAM heatmaps for localization, degrading gracefully (no heatmap,
  never a fabricated one) on failure.
- Entitlement-aware engine selection (`free` / `v1` / `v2beta`) and a
  501("must not fabricate")-safe `503` on inference failure.
- PHI-safe structured logging (request id, entitlement, phash, finding
  count, latency — never image bytes, filenames, or headers).

**Not** in this repo (separate plans, not yet built):
`/api/experimental` admin-console entitlement grant/revoke UI, the
StewardMD frontend `thorex-*.js` module and live-provider wiring, and FHIR
export (Phase 2).

## Running locally (no Docker)

```bash
cd backend/thorex
python -m venv .venv && .venv/bin/pip install -r requirements.txt
# add -r requirements-ml.txt too if you want real TorchXRayVision/X-Raydar/HF inference
cp .env.example .env   # edit THOREX_HF_TOKEN if you want the Free tier live
make dev               # uvicorn app.main:app --reload --port 8000
```

Docs at `http://localhost:8000/docs`, health at `http://localhost:8000/v1/health`.

## Tests: fast vs. models

Two pytest markers split the suite so CI (and everyday dev loops) never pay
the cost of downloading real model weights unless asked:

```bash
make test          # python -m pytest -m "not models" -v   → 30 tests, seconds, no downloads
make test-models    # python -m pytest -m models -v         → real TorchXRayVision/X-Raydar/HF
                    #   weights; slow, downloads GBs, requires network + (for
                    #   X-Raydar) an accepted HF gate + THOREX_HF_TOKEN
```

The fast suite runs entirely against a `MockProvider` / stubbed network and
proves request/response contracts, quality gating, redaction, Grad-CAM
plumbing, and PHI-safe logging without touching real weights.

## The `/v1/analyze` contract

`POST /v1/analyze` — `multipart/form-data`:

| field         | type | required | notes                                            |
|---------------|------|----------|---------------------------------------------------|
| `file`        | file | yes      | PNG/JPEG/HEIC/PDF, ≤ 25 MiB                        |
| `entitlement` | text | no (default `v1`) | one of `free`, `v1`, `v2beta`            |

Entitlement → engines returned:

- `free` → hosted HF engine only (`hf_vit`), the free/no-signup path.
- `v1` → primary detector only (`torchxrayvision`).
- `v2beta` → dual result: `torchxrayvision` **and** the educational-only
  `xraydar` engine (`educational: true`) side by side.

Response body (`AnalysisResult`):

```json
{
  "request_id": "…",
  "quality": { "view": "PA", "adequate": true, "issues": [] },
  "engines": [
    {
      "engine": "torchxrayvision",
      "educational": false,
      "findings": [
        { "label": "Effusion", "band": "Medium", "severity": "moderate",
          "relevance": "…", "heatmap_png_b64": "…" }
      ],
      "disclaimer_key": null
    }
  ],
  "disclaimer_key": "clinical_assist_disclaimer"
}
```

Failure modes: `400` bad entitlement value, `413` file too large, `415`
unsupported format, `503` `inference_unavailable` (an engine could not run —
the service never fabricates a result in this case).

### Disclaimer key contract (mandatory — do not drop when rendering)

- `AnalysisResult.disclaimer_key` is **always** `"clinical_assist_disclaimer"`
  and must be shown for every response, on every tier.
- Each `EngineResult.disclaimer_key` is `"educational_not_clinical"` when
  `educational: true` (currently only the X-Raydar engine) and `null`
  otherwise. Any UI rendering a `v2beta` dual result must surface this
  per-engine key next to the educational panel — the top-level clinical
  disclaimer alone is not sufficient for that engine's output.

## Licensing of the underlying models

- **TorchXRayVision** (primary detector, `torchxrayvision` engine) —
  Apache-2.0. Shippable in a clinical-assist product as-is.
- **X-Raydar** (educational engine, `xraydar` engine, always
  `educational: true`) — vendored inference-only from the University of
  Warwick's `x-raydar/x-raydar-cv`. Licensed for **academic research and
  non-commercial, non-clinical evaluation only**
  (https://github.com/x-raydar/x-raydar-cv/blob/main/LICENSE). This service
  therefore **gates** it: it is only ever returned alongside the primary
  clinical engine, tagged `educational: true`, with the
  `educational_not_clinical` disclaimer key, and only for the `v2beta`
  entitlement. Do not relabel this engine as clinical or ship it standalone.
- **Hosted HF free-tier model** (`codewithdark/vit-chest-xray` by default,
  `hf_vit` engine) — calls a third-party hosted-inference endpoint using a
  server-side `THOREX_HF_TOKEN`; the token is never exposed to clients.
  Check the specific model card's license before pointing
  `THOREX_HF_MODEL` at a different checkpoint.

## Docker / Compose

```bash
docker compose up --build
curl localhost:8000/v1/health
# {"status":"ok","service":"thorex","mode":"local"}
```

- Base image: `python:3.11-slim`.
- OS packages installed: `poppler-utils` (PDF→image), `tesseract-ocr` (OCR
  used by the burned-in-text redactor), `libglib2.0-0` + `libgl1` (OpenCV /
  scikit-image runtime deps).
- `WITH_ML` build arg (default `1`) controls whether `requirements-ml.txt`
  (torch, torchvision, torchxrayvision, monai, grad-cam, huggingface_hub,
  pytesseract) is installed. Set `WITH_ML=0` for a lighter mock-only image.
- Model weights are **not** baked into the image — TorchXRayVision, Grad-CAM
  target layers, and (if configured) X-Raydar/HF weights download on first
  use into `/models` (bind-mounted via the `thorex-models` named volume in
  `docker-compose.yml`), so the container stays small and the cache
  survives restarts.
- `.env` (copy from `.env.example`) supplies `THOREX_MODE`,
  `THOREX_ENVIRONMENT`, `THOREX_HF_TOKEN`, `THOREX_HF_MODEL`. The compose
  file also always sets `THOREX_MODEL_CACHE_DIR=/models` to match the
  volume mount.

### Deploy commands (GPU node)

```bash
# 1. Build the image (from backend/thorex/)
docker build -t thorex-inference:latest --build-arg WITH_ML=1 .

# 2. Tag + push to your registry
docker tag thorex-inference:latest <registry>/thorex-inference:<tag>
docker push <registry>/thorex-inference:<tag>

# 3. Run on a GPU-equipped node (NVIDIA Container Toolkit installed)
docker run -d --gpus all -p 8000:8000 \
  -e THOREX_MODE=local \
  -e THOREX_ENVIRONMENT=prod \
  -e THOREX_HF_TOKEN=<server-side-token> \
  -v thorex-models:/models \
  --name thorex <registry>/thorex-inference:<tag>
```

### Honesty note — what has and has not been run

This repo's development sandbox has **no Docker daemon installed**, so
`docker compose up --build`, the image `docker build`, the registry push,
and the GPU `docker run` above have **not** been executed as part of
building this service. They are recorded here as the exact commands an
operator must run to build and deploy the image; they are standard Docker/
Compose and expected to work unmodified against the `Dockerfile` and
`docker-compose.yml` in this directory, but they still need a real
verification pass (build succeeds, `/v1/health` returns 200, and — with a
GPU node + `WITH_ML=1` + network access to Hugging Face — a real
`make test-models` run) before this is called production-ready.

What **was** verified in this build session, without Docker: the fast test
suite (`make test`, i.e. `pytest -m "not models"`) passes — 30/30 — proving
the FastAPI app boots, imports cleanly, and the full mocked request/response
pipeline (analyze contract, quality gate, redaction, Grad-CAM plumbing,
PHI-safe logging) is intact after adding these deploy files. A plain
`python -c "from app.main import app"` import check also succeeded.
