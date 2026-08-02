FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY william_algorithm/rag /app/william_algorithm/rag

WORKDIR /app/william_algorithm/rag
RUN uv sync --frozen

EXPOSE 8010

CMD [".venv/bin/python3", "-m", "uvicorn", "rag_service:app", "--host", "0.0.0.0", "--port", "8010"]
