# StewardMD Research — Python service

Initial Sprint 1 service for the meta-analysis pilot. It is deliberately separate from KardioX and does not import KardioX internals.

## Run locally

```bash
cd backend/research
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8010
pytest -q
```

`GET /health` is a health probe. `POST /v1/meta-analysis/compute` accepts supplied study estimates and confidence intervals. In production, configure `RESEARCH_WORKER_TOKEN`; the internal endpoint requires `X-Research-Worker-Token`. The service refuses production calls without the token.

## Meta-analysis scope and limitations

- Supported measures: OR, RR, HR (log scale), MD and SMD (linear scale).
- Inputs: study estimate and two-sided confidence interval. Standard errors are derived on the analysis scale.
- Pooling: inverse-variance fixed effect or DerSimonian–Laird random effects.
- Heterogeneity: Cochran Q, I² and tau².
- Output includes forest-plot-ready JSON; chart rendering and manuscript narrative are separate subsequent steps.
- This first implementation uses normal confidence intervals. It does not yet implement REML, Hartung–Knapp, prediction intervals, subgroup/meta-regression, small-study effects, risk-of-bias assessment or GRADE.
- The API does not retrieve papers or infer effect sizes. Each value must be extracted from a source and retained with provenance by the orchestration layer.

Do not use for clinical decision-making. Before publication, independently verify extracted data, analysis choices and results with a qualified statistician/researcher.

## Deployment and queue topology

Cloudflare Pages authenticates Firebase users and persists project/job metadata in the dedicated D1 database. PDFs are written to the private Research R2 bucket. Pages sends study-level effect inputs to the Research Queue. The queue consumer Worker calls this FastAPI service using X-Research-Worker-Token, then calls the authenticated Pages completion callback. See docs/research/DEPLOYMENT_RUNBOOK.md for provisioning. Production must remain disabled until the bindings and secrets are provisioned and reviewed.
