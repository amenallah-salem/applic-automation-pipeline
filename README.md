# applic-automation-pipeline

AI-powered job-application agent foundation. The whole stack boots with a
single `docker compose up` and includes:

| Service     | What it does                                                            | Default port |
| ----------- | ----------------------------------------------------------------------- | ------------ |
| `frontend`  | React + Vite dashboard (served by nginx)                                | `3000`       |
| `backend`   | FastAPI REST API                                                        | `8000`       |
| `postgres`  | PostgreSQL 16 + `pgvector`, shared by all services                      | `5432`       |
| `openwebui` | [Open WebUI](https://openwebui.com) installed from PyPI (see [`openwebui/`](openwebui/)), data on Postgres + pgvector | `3001` |
| `n8n`       | [n8n](https://n8n.io) automation, on Postgres                           | `5678`       |

All services share the `appnet` Docker network and address each other by
service name (`postgres`, `backend`, `openwebui`, `n8n`). Ports above are
exposed on the host.

---

## TL;DR

```bash
git clone https://github.com/amenallah-salem/applic-automation-pipeline.git
cd applic-automation-pipeline
git checkout dev
cp .env.example .env                      # then edit OPENWEBUI_SECRET_KEY + GROQ_API_KEY
docker compose up -d --build              # ~3-5 min on cold cache
./scripts/check.sh                        # 18 health checks; exits non-zero on failure
./scripts/seed_openwebui.py               # admin + 3 users + Groq endpoint
```

Then open <http://localhost:3000> (dashboard) and <http://localhost:3001> (Open WebUI — log in with the credentials printed by the seed script).

---

## 1. Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose v2](https://docs.docker.com/compose/install/) (bundled with
  recent Docker Desktop / Docker Engine installs — `docker compose`, no
  hyphen). The legacy v1 `docker-compose` works but throws a harmless
  `KeyError: 'id'` on log streaming.
- (Optional) a **Groq API key** from <https://console.groq.com/keys> — free
  tier is enough. Real Groq keys start with `gsk_…`.

## 2. Configure environment

```bash
cp .env.example .env
```

The defaults boot a working dev stack on `localhost`. Edit these before
exposing anywhere outside your laptop:

| Variable                                | What to set                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `APP_HOST`                              | The host you'll type in the browser. `localhost`, `127.0.0.1`, or a LAN IP. |
| `OPENWEBUI_SECRET_KEY`                  | Long random string. Generate with `openssl rand -hex 32`.                   |
| `POSTGRES_PASSWORD`                     | Pick something other than `postgres` if exposed.                            |
| `N8N_BASIC_AUTH_USER` / `..._PASSWORD`  | Basic-auth credentials for the n8n UI.                                      |
| `GROQ_API_KEY`                          | Optional, but the seed script wires it into Open WebUI as the first model.  |
| `OPENWEBUI_ADMIN_EMAIL` / `..._PASSWORD`| Optional, override the admin the seed script creates.                       |

`APP_HOST` is the **single knob** that drives every browser-facing origin
in the stack:

| Setting              | Resolved value with `APP_HOST=localhost`                  |
| -------------------- | --------------------------------------------------------- |
| `VITE_API_BASE_URL`  | `http://localhost:8000` (baked into frontend JS at build) |
| `CORS_ORIGINS`       | `["http://localhost:3000"]` (backend whitelist)           |
| `WEBHOOK_URL`        | `http://localhost:5678/`                                  |
| `WEBUI_URL`          | `http://localhost:3001`                                   |
| `N8N_HOST`           | `localhost`                                               |

If you change `APP_HOST` later you **must** rebuild the frontend, because
`VITE_API_BASE_URL` is compiled into the static JS bundle:

```bash
docker compose up -d --build frontend backend
```

Per-service overrides (`VITE_API_BASE_URL`, `CORS_ORIGINS`, …) are
available in `.env.example` for reverse-proxy setups; ignore them for
local use.

## 3. Build & run

```bash
docker compose up --build              # foreground, see all logs
docker compose up --build -d           # detached / background
```

Cold-cache build is ~3–5 minutes (Open WebUI + node + Python deps). After
the first build, subsequent `up` calls just reuse the cached layers.

If your network is flaky and `docker compose build` fails on
`registry-1.docker.io: TLS handshake timeout`, pre-pull the base images
with the helper script and retry:

```bash
./scripts/pull_base_images.sh
docker compose up --build -d
```

See the **Troubleshooting** section for more fallback options.

## 4. Health check

`./scripts/check.sh` runs 18 checks: `.env` sanity, container health,
HTTP probes against every service, a CORS preflight from the frontend
origin to the backend, and Postgres + `pgvector` extension verification.

```bash
./scripts/check.sh           # one-shot, exits non-zero on any failure
./scripts/check.sh --watch   # re-runs every 5s
```

Healthy output ends with `All checks passed (18/18).` This is also the
fastest way to diagnose `TypeError: NetworkError when attempting to
fetch resource` — the script reports exactly which of
`VITE_API_BASE_URL`, `CORS_ORIGINS`, or the live backend CORS header is
the mismatched one.

## 5. Seed Open WebUI (admin + users + Groq)

[`scripts/seed_openwebui.py`](scripts/seed_openwebui.py) bootstraps Open
WebUI in one command: creates an admin account (the first signup is
always the admin in Open WebUI), adds extra user accounts, and
configures a Groq endpoint as the first OpenAI-compatible connection so
its models show up first in the chat model picker.

```bash
GROQ_API_KEY=gsk_xxx ./scripts/seed_openwebui.py
```

Or, if you put `GROQ_API_KEY` in `.env`, the script auto-loads it:

```bash
./scripts/seed_openwebui.py
```

Expected output on a fresh stack:

```
[init] target: http://localhost:3001
[admin] no existing admin, signing up [email protected]
[users] adding 3 user(s)
  - alice@local.test               created (user)
  - bob@local.test                 created (user)
  - charlie@local.test             created (user)
[models] configuring 1 OpenAI-compatible endpoint(s)
  [0] groq       https://api.groq.com/openai/v1                key=gsk_aB…
[models] discovered 19 model(s):
  - groq.llama-3.3-70b-versatile
  - groq.llama-3.1-8b-instant
  ...
== Summary ==
  Admin login: [email protected] / SuperSecret!42
  User login : alice@local.test / AlicePass123!
  ...
```

The script is **idempotent** — re-runs print `exists` for users that are
already created and overwrite the model config (handy for rotating the
Groq key).

### Useful flags

| Flag                          | Purpose                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `--url http://host:3001`      | Point at a non-default Open WebUI host                               |
| `--users-file users.json`     | Replace defaults with a JSON list of `{name,email,password,role?}`   |
| `--skip-models`               | Only create accounts; don't touch model connections                  |
| `--admin-email`, `--admin-password` | Override the admin credentials (also via env vars)             |

Optional env vars (all read from `.env` automatically):
`OPENWEBUI_ADMIN_NAME`, `OPENWEBUI_ADMIN_EMAIL`, `OPENWEBUI_ADMIN_PASSWORD`,
`GROQ_BASE_URL`, plus `OPENROUTER_API_KEY` / `OPENAI_API_KEY` to add
those providers as additional connections next to Groq.

> **Stdlib only** — `urllib` + `json`. No `pip install` required.

### Custom users example

```bash
cat > users.json <<'EOF'
[
  {"name": "Amenallah", "email": "[email protected]", "password": "MyPass123!", "role": "admin"},
  {"name": "Teammate",  "email": "[email protected]",   "password": "TheirPass123!"}
]
EOF
./scripts/seed_openwebui.py --users-file users.json
```

## 6. Access the running stack

| Service          | URL                                                                          |
| ---------------- | ---------------------------------------------------------------------------- |
| Dashboard        | <http://localhost:3000>                                                      |
| API docs         | <http://localhost:8000/docs>                                                 |
| Open WebUI       | <http://localhost:3001>                                                      |
| n8n              | <http://localhost:5678> (basic auth from `.env`)                             |
| Postgres         | `postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5432/$POSTGRES_DB` |

(Replace `localhost` with your `APP_HOST` if you changed it.)

## 7. Daily commands

```bash
# Tail logs for everything (or a single service)
docker compose logs -f
docker compose logs -f backend

# Stop containers (keep volumes — data survives)
docker compose down

# Stop AND wipe Postgres / n8n / Open WebUI volumes (fresh DB on next up)
docker compose down -v

# Rebuild a single service after code changes
docker compose build backend && docker compose up -d backend

# Force-rebuild the frontend after changing APP_HOST or VITE_API_BASE_URL
docker compose up -d --build frontend

# Open a shell in a running container
docker compose exec backend bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB
```

---

## 8. Database schema

On first boot, [`db/init.sql`](db/init.sql) runs against Postgres. It:

1. Creates two companion databases (`openwebui`, `n8n`) used by those
   services.
2. Installs the `vector` extension in `openwebui` (Open WebUI uses
   pgvector for RAG embeddings).
3. Initialises the main app DB with:

- **`job_applications`** — `id (uuid)`, `company_name`, `job_title`,
  `job_url`, `source`, `status`
  (`saved|applied|interview|rejected|offer`), `score (0–100)`, `notes`,
  `created_at`, `updated_at`.
- **`generated_documents`** — `id (uuid)`, `job_id (FK)`,
  `type (cv|cover_letter|message)`, `content`, `created_at`.

The backend also calls `Base.metadata.create_all` on startup as a safety
net for local dev without the init script.

> Postgres skips `init.sql` if the data volume already exists. To
> re-run it (e.g. after editing the schema, or to reinstall the `vector`
> extension), wipe the volume: `docker compose down -v`.

---

## 9. Backend API

FastAPI app under [`backend/app`](backend/app), organised as
`routers/ · models/ · schemas/ · services/ · database.py`.

### Endpoints

| Method | Path                  | Description                               |
| ------ | --------------------- | ----------------------------------------- |
| GET    | `/health`             | Liveness probe                            |
| GET    | `/jobs?status=<s>`    | List applications (optional status filter)|
| POST   | `/jobs`               | Create an application                     |
| GET    | `/jobs/{id}`          | Fetch one application                     |
| PATCH  | `/jobs/{id}`          | Partial update                            |
| DELETE | `/jobs/{id}`          | Delete                                    |
| GET    | `/documents?job_id=…` | List generated documents                  |
| GET    | `/documents/{id}`     | Fetch one document                        |
| POST   | `/generate`           | Placeholder AI generation (Open WebUI stub)|
| POST   | `/webhooks/n8n`       | Incoming webhook for n8n workflows        |

### Examples

```bash
# Create
curl -s -X POST http://localhost:8000/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "company_name": "Acme Corp",
    "job_title": "Senior Engineer",
    "job_url": "https://example.com/jobs/123",
    "source": "linkedin",
    "status": "saved"
  }'

# List + filter
curl -s http://localhost:8000/jobs
curl -s 'http://localhost:8000/jobs?status=applied'

# Update status
curl -s -X PATCH http://localhost:8000/jobs/<id> \
  -H 'Content-Type: application/json' \
  -d '{"status": "interview"}'

# Trigger placeholder generation
curl -s -X POST http://localhost:8000/generate \
  -H 'Content-Type: application/json' \
  -d '{"job_id": "<id>", "type": "cover_letter"}'
```

Full OpenAPI spec at <http://localhost:8000/docs>.

---

## 10. Frontend

Minimal React + Vite dashboard at [`frontend/`](frontend/), served by
nginx in production. Features:

- List + filter applications by status
- Add a new application
- Inline status updates and deletion
- View stored generated documents
- One-click "Generate CV / Cover letter / Message" (calls `POST /generate`)

The API base URL is baked into the JS at build time via the
`VITE_API_BASE_URL` build arg, derived from `APP_HOST + BACKEND_PORT`.
If you open the dashboard on `127.0.0.1` or a LAN IP, change `APP_HOST`
in `.env` to match — see Troubleshooting.

---

## 11. AI / automation integration points

- **Open WebUI**: the backend ships a placeholder
  [`OpenWebUIClient`](backend/app/services/openwebui.py) that returns a
  templated string. After `seed_openwebui.py` has wired up Groq, replace
  `generate` with a real call to `${OPENWEBUI_URL}/api/chat/completions`
  using one of the seeded user tokens.
- **n8n**: see [`n8n/README.md`](n8n/README.md). An example workflow
  lives at
  [`n8n/workflows/example-job-trigger.json`](n8n/workflows/example-job-trigger.json)
  (Manual Trigger → HTTP Request → `POST backend:8000/jobs`). Workflows
  POSTing into `POST /webhooks/n8n` are accepted by the backend.

---

## 12. Project layout

```
applic-automation-pipeline/
├── backend/                FastAPI service
│   ├── app/
│   │   ├── routers/        jobs, documents, generate, webhooks
│   │   ├── models/         SQLAlchemy ORM
│   │   ├── schemas/        Pydantic DTOs
│   │   ├── services/       Open WebUI client (placeholder)
│   │   ├── config.py       pydantic-settings
│   │   ├── database.py     engine + session + Base
│   │   └── main.py         FastAPI app factory
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/               React + Vite dashboard (nginx runtime)
├── openwebui/
│   └── Dockerfile          Single-stage Python build, `pip install open-webui`
├── db/
│   └── init.sql            Postgres schema + pgvector + companion DBs
├── n8n/
│   ├── README.md
│   └── workflows/          Example workflows (mounted at /workflows)
├── scripts/
│   ├── check.sh                Stack health verification (18 checks)
│   ├── seed_openwebui.py       Admin + users + Groq bootstrap
│   ├── pull_base_images.sh     Pre-pull base images (network workaround)
│   └── clean_docker.sh         Convenience cleanup
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 13. Troubleshooting

### Dashboard shows `TypeError: NetworkError when attempting to fetch resource`

The browser is loading the frontend from one host (e.g. `127.0.0.1:3000`
or a LAN IP) but trying to reach the backend on a different one
(`localhost:8000` baked into the JS at build time). Single-knob fix in
`.env`:

```env
APP_HOST=127.0.0.1       # or 192.168.x.y — match the browser address bar
```

Then rebuild:
```bash
docker compose up -d --build frontend backend n8n openwebui
./scripts/check.sh                 # confirms CORS preflight matches
```

The frontend **must** be rebuilt because `VITE_API_BASE_URL` is baked
into the static JS bundle.

### `docker compose build` / `pull` fails with `TLS handshake timeout` or `i/o timeout`

Network issue between Docker and Docker Hub / Cloudflare. Try in order:

1. **Just retry** — Docker Hub is flaky, often works on the next try.
2. **Disconnect VPN / proxy** if you're on one. VPNs commonly mangle MTU
   and break TLS to large CDNs.
3. **Force public DNS + lower MTU** in `/etc/docker/daemon.json`:
   ```json
   { "dns": ["1.1.1.1", "8.8.8.8"], "mtu": 1400 }
   ```
   then `sudo systemctl restart docker`.
4. **Pre-pull base images one at a time** to isolate the failing one:
   ```bash
   ./scripts/pull_base_images.sh
   ```
5. **Disable IPv6** if your ISP advertises broken v6: add
   `"ipv6": false` to `daemon.json`.

Verify Docker Hub is reachable at all:
```bash
curl -v https://registry-1.docker.io/v2/ 2>&1 | head -20
# expect a 401 Unauthorized — anything else means networking is broken.
```

### Open WebUI won't start

- `OPENWEBUI_SECRET_KEY` must be a non-empty string. Generate with
  `openssl rand -hex 32`.
- First boot downloads the embedding model (~90 MB, 30 files from
  HuggingFace) — wait ~30s before declaring failure.
- If you upgraded from a SQLite-backed install, wipe the volume:
  `docker compose down -v` so `db/init.sql` re-runs and creates the
  `vector` extension.

### Seed script: `[models] could not list models` and key shows `org_01…`

The Groq API key you provided is the wrong one. `org_…` is an
organization ID; **real Groq API keys start with `gsk_`**. Get one from
<https://console.groq.com/keys>, update `.env`, re-run
`./scripts/seed_openwebui.py`. Sanity check from the host:
```bash
curl -s -H "Authorization: Bearer $GROQ_API_KEY" \
  https://api.groq.com/openai/v1/models | head -c 300
```
Should return a JSON model list, not an `Invalid API Key` error.

### n8n fails at boot

The `n8n` database must exist — it's created by `db/init.sql` on first
boot. If you migrated from a SQLite-backed n8n, wipe the `n8n_data`
volume and re-up: `docker compose down -v && docker compose up -d`.

### Ports already in use

Override any `*_PORT` variable in `.env`. Don't forget to update
`APP_HOST`-derived URLs if you reverse-proxy.

### Reset everything

```bash
docker compose down -v        # drops all volumes
docker compose up --build -d  # fresh start
./scripts/seed_openwebui.py   # re-create accounts + Groq
```
