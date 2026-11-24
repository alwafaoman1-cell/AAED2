FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng libgomp1 libgl1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ocr_core.py benchmark.py worker.py ./
RUN useradd --create-home --uid 10001 worker
USER worker
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOME=/home/worker PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
# Cache the English recognizer only. New extraction jobs never load Arabic.
# A private document must not trigger a model-host download during OCR.
RUN python -c "from ocr_core import PaddleEnglishProvider; PaddleEnglishProvider()"
ENTRYPOINT ["python", "worker.py"]
