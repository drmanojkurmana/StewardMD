# KardioX pipeline API image — multi-stage build (small runtime, no build tools in the final layer).
#
#   docker build -t kardiox-pipeline .                       # slim API image (mock/live w/ classical stages)
#   docker build --build-arg INSTALL_ML=true -t kardiox-pipeline:ml .   # + vision/signal deps (no torch)
#
# torch/torch_ecg (the rhythm model) belong in a dedicated GPU model-serving image; keep them out of the
# API image so it stays small + fast to deploy. The provider seam isolates that split.

# ---- builder: install deps into an isolated venv ----
FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1
WORKDIR /build
COPY requirements.txt requirements-ml.txt ./
ARG INSTALL_ML=false
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt \
    && if [ "$INSTALL_ML" = "true" ]; then \
         /opt/venv/bin/pip install "numpy>=1.26" "scipy>=1.11" "opencv-python-headless>=4.9" \
                                   "neurokit2>=0.2.7" "wfdb>=4.1"; \
       fi

# ---- runtime: copy the venv + app only ----
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app

# libGL is needed by opencv-python-headless' cv2 import in the ML variant; harmless in the slim variant.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY app ./app

RUN useradd -m -u 10001 kardiox && chown -R kardiox:kardiox /app
USER kardiox

EXPOSE 8000
# liveness inside the container (readiness is /v1/ready; orchestrators should probe that in live mode).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/v1/health').status==200 else 1)"

# uvicorn handles SIGTERM → runs the FastAPI lifespan shutdown → graceful drain.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--timeout-graceful-shutdown", "20"]
