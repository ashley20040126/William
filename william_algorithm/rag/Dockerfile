FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required by unstructured[all-docs]
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libmagic1 \
    poppler-utils \
    tesseract-ocr \
    libreoffice \
    pandoc \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies (no project install, just deps)
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY . .

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV RAG_SERVICE_HOST=0.0.0.0
ENV RAG_SERVICE_PORT=8010

EXPOSE 8010

CMD ["python", "-m", "uvicorn", "rag_service:app", "--host", "0.0.0.0", "--port", "8010"]
