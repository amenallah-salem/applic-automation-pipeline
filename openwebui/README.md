# openwebui — PyPI build

This directory builds an [Open WebUI](https://github.com/open-webui/open-webui)
container from the official PyPI package
([`open-webui` on PyPI](https://pypi.org/project/open-webui/)) instead
of cloning the source repo and compiling the SvelteKit frontend at
build time. The PyPI wheel ships the prebuilt frontend, so:

- No Node toolchain in the build (Dockerfile is single-stage Python).
- Build time drops from ~8 min to ~2-3 min, almost all of it spent
  installing the wheel's transitive deps.
- Pinning a release is just a version string, no git tag.

The shared Postgres from `docker-compose.yml` is used for **all** Open
WebUI storage — it does **not** fall back to SQLite anywhere:

| Storage kind                                              | Where it lives                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Application data (users, chats, files, config, knowledge) | `openwebui` database on the shared Postgres, via `DATABASE_URL`         |
| RAG vector store (embeddings, chunks)                     | Same `openwebui` database, via `VECTOR_DB=pgvector` + `PGVECTOR_DB_URL` |

To make the vector store work on the same Postgres, the `postgres`
service uses the `pgvector/pgvector:pg16` image (Postgres 16 with the
`vector` extension preinstalled) and `db/init.sql` runs
`CREATE EXTENSION IF NOT EXISTS vector` on the `openwebui` database on
first boot. The Dockerfile additionally `pip install`s `psycopg2-binary`
and `pgvector`, which the upstream wheel does not pull in by default
(without them the container crashes at boot with `ImproperlyConfigured:
Postgres driver not installed!`).

## Build / run

The whole pipeline is wired into the root `docker-compose.yml`, so:

```bash
# From the repo root
docker compose build openwebui
docker compose up -d openwebui
```

The embedding model (`sentence-transformers/all-MiniLM-L6-v2`) downloads
on first launch, not at build time, so the very first `up` can take 1-2
minutes before `/health` returns 200.

## Pinning a version

Open WebUI releases move fast and sometimes break. Pin
`OPENWEBUI_VERSION` in `.env` to a specific PyPI release (e.g. `0.9.2`)
once you find one that works for you:

```env
OPENWEBUI_VERSION=0.9.2
```

Leave it blank to install the latest version published on PyPI. The
value is passed to `Dockerfile`'s `ARG OPENWEBUI_VERSION` via
`docker-compose.yml`. Available versions are listed at
<https://pypi.org/project/open-webui/#history>.

## Handling big files

By default Open WebUI rejects large uploads for RAG ingestion. Two env
vars, wired into `docker-compose.yml`, control this:

| Variable             | Meaning                                   | Default |
| -------------------- | ----------------------------------------- | ------- |
| `RAG_FILE_MAX_SIZE`  | Max size (MB) of a single RAG file        | `100`   |
| `RAG_FILE_MAX_COUNT` | Max number of files in a single RAG batch | `10`    |

Override either in `.env`:

```env
RAG_FILE_MAX_SIZE=500
RAG_FILE_MAX_COUNT=50
```

If you also need to raise the reverse-proxy request body limit (for
direct chat attachments), set `client_max_body_size` on any nginx in
front of the stack.

## Patching Open WebUI

If you need to modify Open WebUI itself, switch the Dockerfile back to a
source build: `git clone https://github.com/open-webui/open-webui.git`
inside the build (or `COPY` your fork in), then run
`pip install -e .` instead of `pip install open-webui`. The PyPI install
is a wheel and is not editable on disk.
