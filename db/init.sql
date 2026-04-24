-- Create companion databases for OpenWebUI and n8n on the same Postgres
-- instance. These are created only on first initialisation of the volume.
SELECT 'CREATE DATABASE openwebui'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'openwebui')\gexec
SELECT 'CREATE DATABASE n8n'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec

-- The remaining statements run against POSTGRES_DB, which is the database the
-- postgres docker-entrypoint connects this init script to by default.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS job_applications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT        NOT NULL,
    job_title    TEXT        NOT NULL,
    job_url      TEXT,
    source       TEXT,
    status       TEXT        NOT NULL DEFAULT 'saved'
        CHECK (status IN ('saved', 'applied', 'interview', 'rejected', 'offer')),
    score        INTEGER     CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_documents (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id     UUID        NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
    type       TEXT        NOT NULL
        CHECK (type IN ('cv', 'cover_letter', 'message')),
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_applications_status      ON job_applications(status);
CREATE INDEX IF NOT EXISTS idx_job_applications_created_at  ON job_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_documents_job_id   ON generated_documents(job_id);

-- Finally, enable the pgvector extension on the openwebui database so Open
-- WebUI's vector store (VECTOR_DB=pgvector) can share this same Postgres
-- instance instead of falling back to a local sqlite-backed Chroma file.
-- This runs last because `\c` switches the session permanently.
\c openwebui
CREATE EXTENSION IF NOT EXISTS "vector";
