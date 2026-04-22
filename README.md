# applic-automation-pipeline

AI-powered job-application agent foundation. The whole stack boots with a
single `docker compose up` and includes:

| Service     | What it does                                    | Default port |
| ----------- | ----------------------------------------------- | ------------ |
| `frontend`  | React + Vite dashboard (served by nginx)        | `3000`       |
| `backend`   | FastAPI REST API                                | `8000`       |
| `postgres`  | PostgreSQL 16, shared by all services           | `5432`       |
| `openwebui` | [OpenWebUI](https://openwebui.com) on Postgres  | `3001`       |
| `n8n`       | [n8n](https://n8n.io) automation, on Postgres   | `5678`       |

All services share the `appnet` Docker network and address each other by
service name (`postgres`, `backend`, `openwebui`, `n8n`). Ports above are
exposed on the host.

---

## 1. Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose v2](https://docs.docker.com/compose/install/) (bundled with
  recent Docker Desktop / Docker Engine installs)

## 2. Configure environment

```bash
cp .env.example .env
# edit .env to change ports, passwords, OpenWebUI secret, n8n credentials, …
```

Key variables (see [`.env.example`](.env.example) for the full list):

| Variable                                | Purpose                                |
| --------------------------------------- | -------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD`   | Shared Postgres superuser credentials  |
| `POSTGRES_DB`                           | Main app DB (default `applications`)   |
| `OPENWEBUI_SECRET_KEY`                  | Session secret for OpenWebUI           |
| `N8N_BASIC_AUTH_USER` / `..._PASSWORD`  | Basic-auth credentials for the n8n UI  |
| `BACKEND_PORT` / `FRONTEND_PORT` / …    | Host port overrides                    |

> ⚠️ Change every default password in `.env` before exposing this stack
> outside your machine.

## 3. Run the stack

```bash
# Build images and start everything in the foreground
docker compose up --build

# Or in detached (background) mode
docker compose up --build -d
```

Once all services are healthy:

- Dashboard:  <http://localhost:3000>
- API docs (Swagger): <http://localhost:8000/docs>
- OpenWebUI: <http://localhost:3001>
- n8n:       <http://localhost:5678> (basic auth from `.env`)
- Postgres:  `postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5432/$POSTGRES_DB`

### Common commands

```bash
# Tail logs for all services
docker compose logs -f

# Tail a single service
docker compose logs -f backend

# Stop containers (keep volumes)
docker compose down

# Stop and wipe Postgres / n8n / OpenWebUI volumes
docker compose down -v

# Rebuild a single service after code changes
docker compose build backend && docker compose up -d backend
```

---

## 4. Database schema

On first boot, [`db/init.sql`](db/init.sql) runs against Postgres. It creates
two companion databases (`openwebui`, `n8n`) used by those services, then
initialises the main app DB with:

- **`job_applications`** — `id (uuid)`, `company_name`, `job_title`,
  `job_url`, `source`, `status`
  (`saved|applied|interview|rejected|offer`), `score (0–100)`, `notes`,
  `created_at`, `updated_at`.
- **`generated_documents`** — `id (uuid)`, `job_id (FK)`,
  `type (cv|cover_letter|message)`, `content`, `created_at`.

The backend also calls `Base.metadata.create_all` on startup as a safety net
for local dev without the init script.

---

## 5. Backend API

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
| POST   | `/generate`           | Placeholder AI generation (OpenWebUI stub)|
| POST   | `/webhooks/n8n`       | Incoming webhook for n8n workflows        |

### Example API usage

Create a job:

```bash
curl -s -X POST http://localhost:8000/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "company_name": "Acme Corp",
    "job_title": "Senior Engineer",
    "job_url": "https://example.com/jobs/123",
    "source": "linkedin",
    "status": "saved"
  }'
```

List and filter:

```bash
curl -s http://localhost:8000/jobs
curl -s 'http://localhost:8000/jobs?status=applied'
```

Update status:

```bash
curl -s -X PATCH http://localhost:8000/jobs/<id> \
  -H 'Content-Type: application/json' \
  -d '{"status": "interview"}'
```

Trigger placeholder generation:

```bash
curl -s -X POST http://localhost:8000/generate \
  -H 'Content-Type: application/json' \
  -d '{"job_id": "<id>", "type": "cover_letter"}'
```

Full OpenAPI spec at <http://localhost:8000/docs>.

---

## 6. Frontend

Minimal React + Vite dashboard at
[`frontend/`](frontend/), served by nginx in production. Features:

- List + filter applications by status
- Add a new application
- Inline status updates and deletion
- View stored generated documents
- One-click "Generate CV / Cover letter / Message" (calls `POST /generate`)

The API base URL is baked in at build time via the `VITE_API_BASE_URL`
build arg (default `http://localhost:${BACKEND_PORT}`).

---

## 7. AI / automation integration points

- **OpenWebUI**: the backend ships a placeholder
  [`OpenWebUIClient`](backend/app/services/openwebui.py) that returns a
  templated string. Replace `generate` with a real call to
  `${OPENWEBUI_URL}/api/chat/completions` once you've set up models and an
  API token in OpenWebUI.
- **n8n**: see [`n8n/README.md`](n8n/README.md). An example workflow lives
  at [`n8n/workflows/example-job-trigger.json`](n8n/workflows/example-job-trigger.json)
  (Manual Trigger → HTTP Request → `POST backend:8000/jobs`). Workflows
  POSTing into `POST /webhooks/n8n` are accepted by the backend.

---

## 8. Project layout

```
applic-automation-pipeline/
├── backend/                FastAPI service
│   ├── app/
│   │   ├── routers/        jobs, documents, generate, webhooks
│   │   ├── models/         SQLAlchemy ORM
│   │   ├── schemas/        Pydantic DTOs
│   │   ├── services/       OpenWebUI client (placeholder)
│   │   ├── config.py       pydantic-settings
│   │   ├── database.py     engine + session + Base
│   │   └── main.py         FastAPI app factory
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/               React + Vite dashboard (nginx runtime)
├── db/
│   └── init.sql            Postgres schema + companion DBs
├── n8n/
│   ├── README.md
│   └── workflows/          Example workflows (mounted at /workflows)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 9. Troubleshooting

- **OpenWebUI won't start**: set a strong `OPENWEBUI_SECRET_KEY`
  (`openssl rand -hex 32`). Older versions require a non-empty value.
- **n8n fails at boot**: make sure the `n8n` database exists — it's created
  by `db/init.sql` on first boot. If you upgraded from SQLite, wipe the
  `n8n_data` volume.
- **Ports already in use**: override any `*_PORT` variable in `.env`.
- **Resetting everything**: `docker compose down -v` drops all volumes
  (Postgres data, n8n workflows, OpenWebUI data).
