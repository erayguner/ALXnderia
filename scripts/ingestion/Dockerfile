FROM python:3.12-slim AS base

WORKDIR /app

# Install only runtime deps
COPY scripts/ingestion/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy ingestion package and schema (for reference)
COPY scripts/ingestion/ /app/scripts/ingestion/
COPY schema/ /app/schema/

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Default: Cloud Run Job entry point (override with INGESTION_PROVIDER env var)
CMD ["python", "-m", "scripts.ingestion.entrypoints.gcp_cloudrun"]
