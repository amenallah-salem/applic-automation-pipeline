# syntax=docker/dockerfile:1.6
#
# Open WebUI image — installed straight from PyPI.
#
# This replaces the previous source-build (git clone + node frontend build +
# uv pip install) with a single `pip install open-webui[==X.Y.Z]`. The PyPI
# wheel ships the prebuilt SvelteKit frontend bundle, so we no longer need a
# Node toolchain at all and the build drops from ~8 minutes to <2.
#
# Pin a version with the OPENWEBUI_VERSION build arg / .env knob (default:
# latest). All runtime tuning (DATABASE_URL, VECTOR_DB, RAG_FILE_MAX_SIZE,
# WEBUI_SECRET_KEY, ...) still comes from environment variables in
# docker-compose.yml.

ARG PYTHON_IMAGE=python:3.11-slim-bookworm
ARG OPENWEBUI_VERSION=

FROM ${PYTHON_IMAGE}

ARG OPENWEBUI_VERSION

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENV=prod \
    PORT=8080 \
    HOST=0.0.0.0 \
    HOME=/root \
    DATA_DIR=/app/backend/data \
    SCARF_NO_ANALYTICS=true \
    DO_NOT_TRACK=true \
    ANONYMIZED_TELEMETRY=false \
    WHISPER_MODEL="base" \
    WHISPER_MODEL_DIR="/app/backend/data/cache/whisper/models" \
    RAG_EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2" \
    SENTENCE_TRANSFORMERS_HOME="/app/backend/data/cache/embedding/models" \
    TIKTOKEN_ENCODING_NAME="cl100k_base" \
    TIKTOKEN_CACHE_DIR="/app/backend/data/cache/tiktoken" \
    HF_HOME="/app/backend/data/cache/embedding/models"

# Runtime deps the open-webui wheel calls out to:
#   pandoc / ffmpeg / libsm6 / libxext6  -> document + media processing
#   curl                                 -> healthcheck
#   build-essential gcc python3-dev      -> a couple of native deps build on install
#   libmariadb-dev libpq-dev             -> DB drivers (we use postgres)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential gcc python3-dev \
      pandoc ffmpeg libsm6 libxext6 \
      curl \
      libmariadb-dev libpq-dev \
 && rm -rf /var/lib/apt/lists/*

# Install Open WebUI from PyPI. If OPENWEBUI_VERSION is empty we get the
# latest; otherwise we pin to that exact version (e.g. 0.9.2).
#
# The wheel does NOT pull in psycopg2 (postgres driver) by default — peewee,
# which Open WebUI uses for its app DB, only loads it lazily. We install it
# here so DATABASE_URL=postgresql://... works out of the box; otherwise the
# container crashes at boot with "ImproperlyConfigured: Postgres driver not
# installed!". Same story for pgvector's psycopg dependency.
RUN if [ -n "${OPENWEBUI_VERSION}" ]; then \
        pip install "open-webui==${OPENWEBUI_VERSION}"; \
    else \
        pip install open-webui; \
    fi \
 && pip install psycopg2-binary pgvector

WORKDIR /app/backend
RUN mkdir -p /app/backend/data

EXPOSE 8080

# `open-webui serve` is the official entrypoint exposed by the PyPI package.
# It honours HOST/PORT, DATA_DIR, DATABASE_URL, VECTOR_DB and every other
# env var documented at https://docs.openwebui.com/getting-started/env-configuration
CMD ["open-webui", "serve"]
