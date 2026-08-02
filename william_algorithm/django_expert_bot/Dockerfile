FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

ENV PYTHONUNBUFFERED=1
ENV DEBUG=False

EXPOSE 8000

# Run migrations then start with gunicorn
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn expert_panel_project.wsgi:application --bind 0.0.0.0:8000 --workers 2"]
