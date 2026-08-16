# RunPod GPU image for the FollowCare voice service. One GPU runs BOTH IndicConformer (STT) and
# Indic Parler-TTS (spec §10-11). Start on a 24 GB card (A5000 / RTX 3090 / equivalent).
FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime

ENV PYTHONUNBUFFERED=1 HF_HOME=/models
WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8080
# Single worker: models load once into GPU memory and are shared across concurrent calls.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
