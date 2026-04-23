# syntax=docker/dockerfile:1.6
#
# Source-built Open WebUI image.
#
# This replaces the upstream `ghcr.io/open-webui/open-webui` image with a
# build we fully control. The source is cloned inside the build so every
# `docker compose build openwebui` produces a reproducible image pinned to
# ${OPENWEBUI_REF}. If you want to edit Open WebUI source locally, clone
# the repo into `openwebui/src/` and change the frontend / backend stages
# below to `COPY src/ .` instead of the `git clone` step (see
# openwebui/README.md).

ARG OPENWEBUI_REF=main
ARG NODE_IMAGE=node:22-alpine3.20
ARG PYTHON_IMAGE=python:3.11-slim-bookworm

########################################
# Stage 1 - build the SvelteKit frontend
########################################
FROM ${NODE_IMAGE} AS frontend
ARG OPENWEBUI_REF
ENV NODE_OPTIONS="--max-old-space-size=4096"
WORKDIR /src

RUN apk add --no-cache git \
 && git clone --depth 1 --branch "${OPENWEBUI_REF}" https://github.com/open-webui/open-webui.git . \
 && git log -1 --pretty=%H > /src/.build-hash

RUN npm ci --force
RUN APP_BUILD_HASH="$(cat /src/.build-hash)" npm run build

########################################
# Stage 2 - python runtime
########################################
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENV=prod \
    PORT=8080 \
    HOME=/root \
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

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git build-essential pandoc gcc netcat-openbsd curl jq \
      libmariadb-dev python3-dev ffmpeg libsm6 libxext6 zstd \
 && rm -rf /var/lib/apt/lists/*

# Bring the built frontend + backend source over from stage 1.
WORKDIR /app
COPY --from=frontend /src /app

# Install python deps.
WORKDIR /app/backend
RUN pip install --no-cache-dir uv \
 && uv pip install --system --no-cache-dir -r requirements.txt

EXPOSE 8080

# start.sh lives in /app/backend and is the upstream entrypoint.
CMD ["bash", "start.sh"]
