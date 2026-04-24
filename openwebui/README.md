# openwebui — source build

This directory builds [Open WebUI](https://github.com/open-webui/open-webui)
from source instead of pulling the upstream
`ghcr.io/open-webui/open-webui` image. It exists so you can:

1. **Pin a specific commit / tag** via the `OPENWEBUI_REF` build arg.
2. **Tweak how Open WebUI handles large files** (RAG ingestion limits,
   content extraction limits) via env vars in `docker-compose.yml`.
3. **Patch the Open WebUI source** (frontend or backend) before building.

The shared Postgres from `docker-compose.yml` is used for **all** Open
WebUI storage — it does **not** fall back to SQLite anywhere:

| Storage kind               | Where it lives                                                  |
| -------------------------- | --------------------------------------------------------------- |
| Application data (users, chats, files, config, knowledge) | `openwebui` database on the shared Postgres, via `DATABASE_URL` |
| RAG vector store (embeddings, chunks) | Same `openwebui` database, via `VECTOR_DB=pgvector` + `PGVECTOR_DB_URL` |

To make the vector store work on the same Postgres, the `postgres`
service uses the `pgvector/pgvector:pg16` image (Postgres 16 with the
`vector` extension preinstalled) and `db/init.sql` runs
`CREATE EXTENSION IF NOT EXISTS vector` on the `openwebui` database on
first boot.

## Build / run

The whole pipeline is wired into the root `docker-compose.yml`, so:

```bash
# From the repo root
docker compose build openwebui
docker compose up -d openwebui
```

First build is slow (frontend compile + backend deps), subsequent builds
are cached. The embedding model (`sentence-transformers/all-MiniLM-L6-v2`)
downloads on first launch, not at build time, so the very first
`up` can take 1-2 minutes before the `/health` check passes.

## Pinning a version

Open WebUI releases move fast and sometimes break. Pin `OPENWEBUI_REF`
in `.env` to a tag (e.g. `v0.5.20`) once you find one that works for
you:

```env
OPENWEBUI_REF=v0.5.20
```

This value is passed to `Dockerfile`'s `ARG OPENWEBUI_REF` via
`docker-compose.yml`.

## Handling big files

By default Open WebUI rejects large uploads for RAG ingestion. Two env
vars, wired into `docker-compose.yml`, control this:

| Variable              | Meaning                                   | Default |
| --------------------- | ----------------------------------------- | ------- |
| `RAG_FILE_MAX_SIZE`   | Max size (MB) of a single RAG file        | `100`   |
| `RAG_FILE_MAX_COUNT`  | Max number of files in a single RAG batch | `10`    |

Override either in `.env`:

```env
RAG_FILE_MAX_SIZE=500
RAG_FILE_MAX_COUNT=50
```

If you also need to raise the reverse-proxy request body limit (for
direct chat attachments), see Open WebUI's docs on the
`WEBUI_BUILD_HASH` / proxy settings, or set `client_max_body_size` on
any nginx in front of the stack.

## Editing the source locally

The default `Dockerfile` git-clones Open WebUI inside the build, so no
source lives on disk. If you want to modify the source:

```bash
# From the repo root
git clone https://github.com/open-webui/open-webui.git openwebui/src
```

Then edit `openwebui/Dockerfile` and replace the `git clone` step in
the frontend stage with a `COPY src/ .` (and drop the `apk add git`
line). Rebuild with `docker compose build openwebui`.

`openwebui/src/` is already in `.gitignore` so your local fork of
Open WebUI never accidentally gets committed to this repo.
