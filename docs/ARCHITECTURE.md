# Architecture & Pipeline

How the four apps in this stack — **Frontend (React)**, **Backend (FastAPI)**,
**Open WebUI**, **n8n** — fit together around a single Postgres, and how they
should be used to take a job posting all the way from "saved" to "applied" with
generated documents and a follow-up plan.

This doc has two layers, clearly separated:

- **Today** — what's implemented in `dev` right now.
- **Recommended** — the next-step automations to wire up. Marked
  `🟡 Recommended` so you don't confuse them with shipping behavior.

---

## 1. Topology

```
                                    ┌─────────────────────────┐
                                    │         Browser          │
                                    │  http://APP_HOST:3000    │
                                    └────────────┬─────────────┘
                                                 │  REST + JSON
                                                 ▼
            ┌──────────────────────────────────────────────────────┐
            │  Frontend (nginx serving Vite build)  :3000          │
            │  - Sidebar / topbar / table / modals / drawer        │
            │  - Calls VITE_API_BASE_URL (= backend) directly      │
            └────────────────────┬─────────────────────────────────┘
                                 │  fetch()  /jobs /documents /generate
                                 ▼
            ┌──────────────────────────────────────────────────────┐
            │  Backend (FastAPI / SQLAlchemy)         :8000        │
            │  Routers: jobs, documents, generate, webhooks        │
            │  Service: OpenWebUIClient (placeholder today)        │
            └──────┬───────────────────────────────┬───────────────┘
                   │ SQL                            │ HTTP (model API)
                   ▼                                ▼
        ┌───────────────────┐               ┌──────────────────────┐
        │ Postgres :5432    │◄──────────────┤ Open WebUI :3001     │
        │  applications DB  │   SQL (data + │ - Chat UI            │
        │  openwebui   DB   │   pgvector)   │ - Model picker       │
        │  n8n         DB   │               │ - RAG over uploaded  │
        └─────────▲─────────┘               │   docs (pgvector)    │
                  │                         │ - OpenAI-compatible  │
                  │ SQL                     │   API at /openai/*   │
                  │                         └──────────┬───────────┘
                  │                                    │ external
                  │                                    ▼
        ┌─────────┴───────────────────────────┐   ┌─────────────┐
        │  n8n :5678                          │   │ Groq /      │
        │  - Workflow runtime                 │   │ OpenAI /    │
        │  - HTTP / Browser / Cron / etc.     │   │ OpenRouter  │
        │  - Calls backend OR plays the role  │   │ (LLM API)   │
        │    of an external job board client  │   └─────────────┘
        └─────────────────────────────────────┘
```

All five containers share `appnet`. Inside the network, services address each
other by service name (`postgres`, `backend`, `openwebui`, `n8n`). From the
browser, everything goes through `APP_HOST` on its published port.

---

## 2. Per-app role

### 2.1 Frontend — `frontend/` (React + Vite, served by nginx)

**Source of truth in code**: `frontend/src/App.jsx`,
[`frontend/src/styles.css`](../frontend/src/styles.css).

What it does:

- Lists, filters, creates, updates, deletes job applications.
- Triggers the backend `POST /generate` to produce a CV / cover letter /
  message for a given job.
- Lists generated documents per job (drawer on the right).
- Links out to Open WebUI (`AI Generate`) and n8n (`Webhooks`) for the human
  to drive those tools directly when needed.

What it does **not** do:

- Talk to Open WebUI or n8n directly. The backend is the only thing it calls.
- Hold any auth state. (No login screen yet — see §6 Recommended.)

### 2.2 Backend — `backend/app/` (FastAPI + SQLAlchemy + Pydantic v2)

Routers (mounted in `main.py`):

| Path | Method | What it does | File |
|---|---|---|---|
| `/health` | GET | liveness | `main.py` |
| `/jobs` | GET / POST | list & create applications | `routers/jobs.py` |
| `/jobs/{id}` | GET / PATCH / DELETE | read & mutate one | `routers/jobs.py` |
| `/documents` | GET | list documents (filter by `job_id`) | `routers/documents.py` |
| `/documents/{id}` | GET | read one | `routers/documents.py` |
| `/generate` | POST | generate a doc for a job via Open WebUI | `routers/generate.py` |
| `/webhooks/n8n` | POST | receive events from n8n workflows | `routers/webhooks.py` |

The **`OpenWebUIClient`** (`backend/app/services/openwebui.py`) is currently a
placeholder that returns a templated string. It's the seam where the real
Open WebUI call belongs (see §3.1).

### 2.3 Open WebUI — `openwebui/` (PyPI build of `open-webui`)

What it does for the pipeline:

- **Chat UI** for humans to iterate on prompts, generate documents, debug
  models, and upload supporting files (CVs, transcripts, profile JSON).
- **RAG store** on the same Postgres via `pgvector` (the `openwebui` DB has
  the `vector` extension installed by `db/init.sql`). Anything you upload in
  Knowledge / Workspace becomes retrievable context.
- **Model gateway**: through Settings → Connections you point it at Groq /
  OpenAI / OpenRouter / Ollama. The seed script (`scripts/seed_openwebui.py`)
  configures a Groq endpoint by default.
- **OpenAI-compatible API**: Open WebUI re-exposes its connected providers
  under `http://openwebui:8080/openai/v1/...`. That's the URL the backend can
  call to delegate generation without ever touching provider keys directly.

What it does **not** do:

- It is **not** an automation engine. Long-running scripted flows belong in
  n8n. Open WebUI is for interactive chat, RAG, and acting as an LLM proxy.

### 2.4 n8n — `n8n/` workflows

What it does for the pipeline:

- Hosts long-running, scheduled, multi-step flows: scrape a job board, log
  in, fill a form, click submit, retry on failure, post results back to the
  backend.
- Gets triggered three ways:
  1. **Webhook** — backend can POST to `http://n8n:5678/webhook/<path>` after
     a row transitions to `applied`.
  2. **Cron** — `Schedule Trigger` node fires every N minutes.
  3. **Manual** — the human clicks *Execute* in the editor for ad-hoc runs.
- Talks back to the backend via `POST http://backend:8000/jobs` /
  `PATCH /jobs/{id}` to update state, and via `POST /webhooks/n8n` to push
  events for monitoring.

The example workflow shipped today is
[`n8n/workflows/example-job-trigger.json`](../n8n/workflows/example-job-trigger.json):
a manual trigger that creates one job row through the backend. It's a
template, not the production pipeline — see §4 for the full design.

### 2.5 Postgres — shared

Three databases on one instance, all backed by `pgvector/pgvector:pg16`:

| DB | Purpose | Owner |
|---|---|---|
| `applications` | `job_applications`, `generated_documents` (the schema in `db/init.sql`) | Backend |
| `openwebui` | Open WebUI users, chats, files, **+ pgvector RAG store** | Open WebUI |
| `n8n` | Workflow definitions, executions, credentials | n8n |

Schema for `applications` (today):

```
job_applications( id UUID, company_name, job_title, job_url, source,
                  status ∈ {saved, applied, interview, rejected, offer},
                  score 0..100, notes, created_at, updated_at )
generated_documents( id UUID, job_id FK, type ∈ {cv, cover_letter, message},
                     content TEXT, created_at )
```

Indexes on `status` and `created_at DESC` so the frontend's status filter and
"newest first" listing stay fast.

---

## 3. Document generation flow (CV / cover letter / message)

### 3.1 Today

```
User → Frontend  (clicks "Generate CV" in the documents drawer)
Frontend → Backend  POST /generate { job_id, type, prompt? }
Backend  → DB       SELECT job_applications WHERE id = :job_id
Backend  → OpenWebUIClient.generate(...)   ← currently a STUB
Backend  → DB       INSERT INTO generated_documents (...)
Frontend → Backend  GET /documents?job_id=...   (refetch)
```

The stub returns a string like
`[PLACEHOLDER CV] for 'Senior SWE' at 'Acme'. Replace this with a real Open WebUI call at http://openwebui:8080.`
This is enough to verify the data round-trip end-to-end without an LLM bill.

### 3.2 🟡 Recommended — make `OpenWebUIClient` real

Open WebUI exposes an OpenAI-compatible API at
`http://openwebui:8080/openai/v1/chat/completions`. Replace the placeholder in
`backend/app/services/openwebui.py` with:

1. On startup, call `POST /api/v1/auths/signin` with a service-account email
   (e.g. `backend@local`) to obtain a bearer token. Cache it.
2. For each generation, build a chat-style payload:

   ```jsonc
   {
     "model": "groq.llama-3.3-70b-versatile",     // or whatever is preferred
     "messages": [
       {"role": "system", "content": "<doc-type-specific prompt>"},
       {"role": "user",   "content": "<job + candidate context>"}
     ],
     "stream": false
   }
   ```

3. POST to `http://openwebui:8080/openai/v1/chat/completions` with
   `Authorization: Bearer <token>`. Take `choices[0].message.content`.
4. **Optionally** attach RAG: pre-upload the candidate's CV and project
   portfolio to a Knowledge collection in Open WebUI, then include
   `"files": [{"id": "<knowledge-id>", "type": "collection"}]` in the request.
   Open WebUI does retrieval before calling the model.

Document-type prompts to centralize (server-side, not client-side, so the
frontend can't drift):

| Type | System prompt skeleton |
|---|---|
| `cv` | "You are a senior tech recruiter. Tailor this CV in markdown for the role at {company}. Keep facts truthful — only re-order and re-phrase. Do not invent positions." |
| `cover_letter` | "Write a 3-paragraph cover letter to {company} for {job_title}. Tone: confident, specific, no fluff." |
| `message` | "Write a 5-sentence LinkedIn message to a recruiter at {company} about the {job_title} role." |

### 3.3 🟡 Recommended — store the rendered file, not just text

Today `generated_documents.content` is `TEXT`. For PDFs / DOCX you'll want
either:

- a `path` column pointing into an object store (MinIO / S3) — keeps Postgres
  small; or
- a `bytea` column for blobs — simpler ops, fine for ≤ ~5 MB per doc.

Pair with an `n8n` "Generate PDF" node (or the `weasyprint` Python lib in the
backend) so the user can download a real CV, not just markdown.

---

## 4. End-to-end submission pipeline (n8n)

This is the meat of "automating the full pipeline" — the part that today is
mostly a placeholder. Below is the recommended design.

### 4.1 Trigger paths (any of these starts a run)

1. **User clicks "Apply" in the frontend** → backend transitions a row from
   `saved` to `applied` and POSTs to
   `http://n8n:5678/webhook/apply` with `{ job_id }`.
2. **Cron** — every N minutes, n8n queries
   `GET http://backend:8000/jobs?status=saved` and picks ones with
   `score >= threshold` (auto-apply mode).
3. **Manual** — open the workflow in the n8n editor and Execute, supplying a
   `job_id`.

### 4.2 Pipeline shape

```
[Trigger] ──► [Backend: GET /jobs/{id}]
              ↓
              [Branch by source]
                ├─ source = linkedin   ─► [Sub-flow: LinkedIn EasyApply]
                ├─ source = greenhouse ─► [Sub-flow: Greenhouse Form Fill]
                ├─ source = workday    ─► [Sub-flow: Workday]
                └─ default             ─► [Sub-flow: Generic HTML Form]
              ↓
              [Backend: POST /generate { job_id, type:"cv" }]
              [Backend: POST /generate { job_id, type:"cover_letter" }]
              ↓
              [Render PDF (CV + cover letter)]
              [Upload to object store, capture URL]
              ↓
              [Browser sub-flow] – open posting URL, log in, fill form,
                                   attach PDFs, hit Submit, screenshot
              ↓
              [If success]
                  Backend: PATCH /jobs/{id} {status:"applied", notes:"..."}
                  Backend: POST /webhooks/n8n
                            { event:"applied", job_id, screenshot_url }
              [Else]
                  Backend: PATCH /jobs/{id} {status:"saved", notes:"FAILED: ..."}
                  Backend: POST /webhooks/n8n {event:"apply_failed", ...}
              ↓
              [Schedule follow-up node] – +5 days: send LinkedIn message
                                          +10 days: email follow-up
                                          +14 days: mark "no response"
```

### 4.3 Browser sub-flows (logging in, filling, submitting)

Two viable engines inside n8n:

- **Native HTTP Request nodes** — fast, but only works for "simple" job
  boards that have a public REST API or a plain HTML form. Most don't.
- **Browser automation** — recommended for LinkedIn / Workday / Greenhouse:
  - Add the
    [n8n-nodes-puppeteer](https://www.npmjs.com/package/n8n-nodes-puppeteer)
    or `n8n-nodes-playwright` community node, OR
  - Run a separate `headless-chrome` container in compose and call it from
    n8n via HTTP (a tiny Python/Node wrapper around Playwright). This keeps
    the n8n image lean and lets you scale browser workers separately.

Credentials per platform go in **n8n → Credentials**, never in the workflow
JSON. Use `Credential Type: Generic Header Auth` for cookies / bearer tokens
exported from a logged-in browser session, or `HTTP Basic Auth` where
applicable. **Never** commit a credentials file — rotate by editing in the
n8n UI.

### 4.4 Storage of generated docs + screenshots

🟡 Recommended addition to compose:

```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes: [minio_data:/data]
    ports: ["9000:9000", "9001:9001"]
    networks: [appnet]
```

Buckets to create (n8n's `MinIO` node can create on first use):

- `applic-cvs/{job_id}/cv.pdf`
- `applic-cvs/{job_id}/cover_letter.pdf`
- `applic-runs/{job_id}/{timestamp}/screenshot.png`
- `applic-runs/{job_id}/{timestamp}/page.html`  (raw form HTML for debugging)

Backend stores only the URL/key in `generated_documents` (or a new
`submission_runs` table — see §5).

### 4.5 Recommended follow-up automations

Each adds one more workflow file under `n8n/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `follow-up-linkedin.json` | Cron daily | For every job applied >5 days ago with no response, send a LinkedIn message via the user's account. Message body comes from `POST /generate type=message`. |
| `follow-up-email.json` | Cron daily | Same but via Gmail node (OAuth credential in n8n). |
| `find-recruiter.json` | After `applied` event | Search LinkedIn for "{job_title} recruiter at {company_name}", insert into a `contacts` table, optionally send a connection request. |
| `weekly-digest.json` | Cron weekly | Pull stats from `GET /jobs`, compute counts by status, email a summary. |

---

## 5. Database write/read patterns

### 5.1 Today

| Operation | Writer | Path |
|---|---|---|
| Create application | Frontend | `POST /jobs` → `INSERT INTO job_applications` |
| Update status | Frontend (status `<select>` per row) | `PATCH /jobs/{id}` |
| Delete | Frontend | `DELETE /jobs/{id}` |
| Generate doc | Frontend | `POST /generate` → `INSERT INTO generated_documents` |
| Read all | Frontend (table) | `GET /jobs?status=...` |

Open WebUI and n8n write to **their own** databases (`openwebui`, `n8n`).
They do **not** touch `applications` directly — they should always go
through the backend's REST API. This keeps validation, business logic, and
audit in one place.

### 5.2 🟡 Recommended schema additions

For the full pipeline you'll want:

```sql
-- Per-attempt run log so you can debug "why did this not submit?"
CREATE TABLE submission_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMPTZ,
    status       TEXT NOT NULL CHECK (status IN
                  ('queued','running','succeeded','failed','retrying')),
    n8n_execution_id TEXT,           -- reference back to n8n's own run record
    screenshot_url   TEXT,
    error_message    TEXT
);
CREATE INDEX idx_submission_runs_job_id ON submission_runs(job_id);
CREATE INDEX idx_submission_runs_status ON submission_runs(status);

-- Recruiters / contacts you've reached out to
CREATE TABLE contacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID REFERENCES job_applications(id) ON DELETE SET NULL,
    full_name    TEXT NOT NULL,
    company_name TEXT,
    role         TEXT,
    linkedin_url TEXT,
    email        TEXT,
    source       TEXT,               -- where you found them
    last_touched TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Outbound messages (LinkedIn / email / etc.) so follow-ups are de-duped
CREATE TABLE outreach (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID REFERENCES job_applications(id) ON DELETE CASCADE,
    contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
    channel      TEXT NOT NULL CHECK (channel IN ('linkedin','email','twitter','other')),
    direction    TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
    body         TEXT,
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

n8n writes to these via the backend (`POST /submission-runs`,
`POST /contacts`, `POST /outreach` — endpoints to add to the backend in the
same PR that adds the tables).

---

## 6. Monitoring & observability

### 6.1 Today

- **Health**: `./scripts/check.sh` does 18 probes (HTTP, CORS preflight,
  Postgres extensions, container health). Run anytime.
- **Compose health**: every service has a Docker `healthcheck`; `docker compose ps`
  shows `(healthy) / (unhealthy)` instead of just `Up`.
- **Logs**: `docker compose logs -f backend` (or `frontend`, `openwebui`,
  `n8n`).
- **n8n executions**: built-in, visible at <http://APP_HOST:5678/executions>
  with full input/output per node.

### 6.2 🟡 Recommended — a real dashboard

The frontend already has a `Webhooks` view that links to n8n. Extend it (or
add a new `Monitoring` view) backed by:

| Card | Source query |
|---|---|
| Applied this week | `SELECT count(*) FROM job_applications WHERE status='applied' AND updated_at > now() - interval '7 days'` |
| Submission success rate | `SELECT status, count(*) FROM submission_runs WHERE started_at > now() - interval '7 days' GROUP BY status` |
| Pending follow-ups | `SELECT count(*) FROM job_applications WHERE status='applied' AND updated_at < now() - interval '5 days' AND id NOT IN (SELECT job_id FROM outreach WHERE direction='outbound')` |
| Last 10 n8n failures | join `submission_runs` with backend `/webhooks/n8n` payloads (or query n8n's own DB read-only) |

Add a backend endpoint `GET /metrics` that returns this as JSON; the
frontend polls every 30 s.

For deeper ops monitoring (production):

- **Prometheus** — scrape `/health`, n8n's `/metrics`, Open WebUI's
  `/metrics`, and `pg_exporter`.
- **Grafana** — dashboards from those metrics + Postgres queries.
- **Alerts** — `submission_runs.status='failed'` rate > 20%, or
  `pending follow-ups > 50`, fires a webhook back into n8n which DMs Slack.

---

## 7. Security recommendations (read before going beyond local dev)

- **Backend auth**: today the API is open. Add an auth dependency
  (bearer token from env, or full Open WebUI–issued JWT) before exposing
  beyond localhost.
- **Service accounts**: when the backend calls Open WebUI, use a dedicated
  `backend@local` service account, **not** the seed-script admin.
- **n8n credentials**: store all platform passwords in n8n's encrypted
  credential store (`N8N_ENCRYPTION_KEY` env var must be stable + secret),
  never inline in workflow JSON.
- **TLS**: front the whole stack with a reverse proxy (Caddy or Traefik)
  doing automatic HTTPS once `APP_HOST` is a real domain.
- **CORS**: today `CORS_ORIGINS` is a single host. Don't widen to `"*"`.
- **Rate limit job-board scrapers**: most platforms ban accounts that submit
  too fast. n8n's `Wait` node + jitter is your friend (e.g. random 30–120 s
  between submissions).

---

## 8. Where things live

```
applic-automation-pipeline/
├── frontend/        # React SPA — the human-facing dashboard
├── backend/         # FastAPI — the only thing that touches the apps DB
├── openwebui/       # Open WebUI Dockerfile (PyPI build) + README
├── n8n/             # n8n compose service + example workflows
├── db/init.sql      # Postgres bootstrap (creates DBs, tables, pgvector ext)
├── scripts/
│   ├── check.sh             # 18-point health check
│   └── seed_openwebui.py    # admin/users/Groq endpoint bootstrap
└── docs/
    └── ARCHITECTURE.md      # this file
```

---

## 9. Quick reference

| I want to… | Go to |
|---|---|
| Add a new application by hand | Frontend → **+ Add application** |
| Generate a CV/letter for one row | Frontend → docs icon → **Generate CV** (calls backend `/generate`) |
| Talk to an LLM directly, upload context, debug a prompt | Open WebUI at `:3001` |
| Build/edit the auto-submit workflow | n8n at `:5678` |
| See if everything's healthy | `./scripts/check.sh` |
| Reset everything | `docker compose down -v && docker compose up -d --build` |
| Wire the backend to a real LLM | Edit `backend/app/services/openwebui.py` (§3.2) |
| Add storage for PDFs / screenshots | Add MinIO service (§4.4) |
| Add follow-up automations | Drop a workflow file under `n8n/workflows/` (§4.5) |
