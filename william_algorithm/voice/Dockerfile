FROM python:3.12-slim

WORKDIR /app

# ffmpeg is required by voice_service.py for audio decoding
# webrtcvad needs gcc, libffi for build
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY . .

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV VOICE_SERVICE_HOST=0.0.0.0
ENV VOICE_SERVICE_PORT=8020

EXPOSE 8020

CMD ["python", "-m", "uvicorn", "voice_service:app", "--host", "0.0.0.0", "--port", "8020"]
