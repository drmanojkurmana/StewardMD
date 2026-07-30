FROM python:3.11-slim
WORKDIR /app
# libglib2.0-0: runtime lib opencv-python-headless needs (the layout-crop preprocessor)
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py layout_crop.py image_model.pt image_model_mireal.pt image_model_v2.pt ./
ENV PORT=8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
