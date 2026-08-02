FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv imageio-ffmpeg
RUN ln -sf "$(python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')" /usr/local/bin/ffmpeg

COPY william_algorithm/voice /app/william_algorithm/voice

WORKDIR /app/william_algorithm/voice
RUN uv sync --frozen

EXPOSE 8020

CMD [".venv/bin/python3", "-m", "uvicorn", "voice_service:app", "--host", "0.0.0.0", "--port", "8020"]
