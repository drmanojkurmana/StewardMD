FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir torch==2.4.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py net1d.py tasks.txt 1_lead_ECGFounder.pth ./
ENV PORT=8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
