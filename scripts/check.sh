#!/usr/bin/env bash
# scripts/check.sh — verify the whole stack is healthy.
#
# Usage:
#   ./scripts/check.sh            # run all checks once and exit non-zero on failure
#   ./scripts/check.sh --watch    # re-run every 5s until you Ctrl-C
#
# What it checks:
#   1. .env exists, APP_HOST + key vars set
#   2. docker compose resolves VITE_API_BASE_URL / CORS_ORIGINS / WEBHOOK_URL
#      to the same host (catches the classic NetworkError mismatch)
#   3. Every container is `running` and (where applicable) `healthy`
#   4. HTTP probes from the host reach each service:
#        - backend  /health
#        - frontend /
#        - openwebui /health
#        - n8n /healthz
#   5. Postgres has the 3 expected databases (applications / openwebui / n8n)
#      and the `vector` extension on openwebui

set -uo pipefail

# --- pretty output ---------------------------------------------------------
if [[ -t 1 ]]; then
  RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[34m'; DIM=$'\e[2m'; RST=$'\e[0m'
else
  RED=''; GRN=''; YLW=''; BLU=''; DIM=''; RST=''
fi

PASS=0; FAIL=0
ok()   { echo "  ${GRN}OK${RST}    $*";       PASS=$((PASS+1)); }
bad()  { echo "  ${RED}FAIL${RST}  $*";       FAIL=$((FAIL+1)); }
warn() { echo "  ${YLW}WARN${RST}  $*"; }
hdr()  { echo; echo "${BLU}== $* ==${RST}"; }

# --- find compose command --------------------------------------------------
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "${RED}docker compose / docker-compose not found${RST}" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

run_once() {
  PASS=0; FAIL=0
  echo "${DIM}$(date)${RST}"

  # 1. .env
  hdr ".env"
  if [[ -f .env ]]; then
    ok ".env exists"
    # shellcheck disable=SC1091
    set -a; source .env; set +a
    : "${APP_HOST:=localhost}"
    : "${BACKEND_PORT:=8000}"
    : "${FRONTEND_PORT:=3000}"
    : "${OPENWEBUI_PORT:=3001}"
    : "${N8N_PORT:=5678}"
    : "${POSTGRES_PORT:=5432}"
    : "${POSTGRES_USER:=postgres}"
    : "${POSTGRES_DB:=applications}"
    : "${OPENWEBUI_DB:=openwebui}"
    : "${N8N_DB:=n8n}"
    echo "        APP_HOST=${APP_HOST}  BACKEND=${BACKEND_PORT}  FRONTEND=${FRONTEND_PORT}  OPENWEBUI=${OPENWEBUI_PORT}  N8N=${N8N_PORT}"
  else
    bad ".env missing — copy .env.example to .env"
  fi

  # 2. compose-resolved origins agree with APP_HOST
  hdr "Compose-resolved origins"
  resolved="$($DC config 2>/dev/null)"
  if [[ -z "$resolved" ]]; then
    bad "$DC config failed — check syntax"
  else
    vite=$(echo "$resolved" | awk '/VITE_API_BASE_URL:/ {print $2; exit}')
    cors=$(echo "$resolved" | awk -F': ' '/CORS_ORIGINS:/ {print $2; exit}')
    webhook=$(echo "$resolved" | awk '/WEBHOOK_URL:/ {print $2; exit}')
    webui=$(echo "$resolved" | awk '/WEBUI_URL:/ {print $2; exit}')
    n8nhost=$(echo "$resolved" | awk '/N8N_HOST:/ {print $2; exit}')
    echo "        VITE_API_BASE_URL = $vite"
    echo "        CORS_ORIGINS      = $cors"
    echo "        WEBHOOK_URL       = $webhook"
    echo "        WEBUI_URL         = $webui"
    echo "        N8N_HOST          = $n8nhost"
    if [[ "$vite" == *"$APP_HOST"* ]]; then
      ok "VITE_API_BASE_URL contains APP_HOST=${APP_HOST}"
    else
      bad "VITE_API_BASE_URL does NOT match APP_HOST=${APP_HOST} — rebuild frontend after fixing .env"
    fi
    if [[ "$cors" == *"$APP_HOST"* ]]; then
      ok "CORS_ORIGINS contains APP_HOST=${APP_HOST}"
    else
      bad "CORS_ORIGINS does NOT contain APP_HOST=${APP_HOST} — restart backend after fixing .env"
    fi
  fi

  # 3. container status
  hdr "Containers"
  ps_json="$($DC ps --format json 2>/dev/null || true)"
  if [[ -z "$ps_json" || "$ps_json" == "[]" || "$ps_json" == "null" ]]; then
    # compose v1 fallback (no --format json support)
    ps_text="$($DC ps 2>/dev/null || true)"
    if [[ -z "$ps_text" ]]; then
      bad "no containers found — run: $DC up -d"
    else
      echo "$ps_text" | sed 's/^/        /'
      warn "compose v1 detected; container health parsing skipped"
    fi
  else
    # python3 handles both v2 outputs: one JSON object per line, or a JSON array.
    parsed=$(printf '%s' "$ps_json" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
items = []
if raw.startswith("["):
    items = json.loads(raw)
else:
    for line in raw.splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
for it in items:
    print("\t".join([it.get("Name",""), it.get("State",""), it.get("Health","")]))
' 2>/dev/null)
    if [[ -z "$parsed" ]]; then
      bad "could not parse `$DC ps --format json` output"
    else
      while IFS=$'\t' read -r name state health; do
        [[ -z "$name" ]] && continue
        label="$state${health:+ ($health)}"
        if [[ "$state" == "running" && ( -z "$health" || "$health" == "healthy" ) ]]; then
          ok "$name — $label"
        elif [[ "$state" == "running" && "$health" == "starting" ]]; then
          warn "$name — $label (still starting)"
        else
          bad "$name — $label"
        fi
      done <<< "$parsed"
    fi
  fi

  # 4. HTTP probes
  hdr "HTTP probes (host -> container)"
  probe() {
    local label="$1" url="$2" expected="${3:-200}"
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$url" 2>/dev/null || echo "000")
    if [[ "$code" == "$expected" || ( "$expected" == "200" && "$code" =~ ^(200|301|302|307|308)$ ) ]]; then
      ok "$label  ($code)  $url"
    else
      bad "$label  ($code)  $url  — expected $expected"
    fi
  }
  probe "backend  /health    " "http://localhost:${BACKEND_PORT}/health"
  probe "backend  /jobs      " "http://localhost:${BACKEND_PORT}/jobs"
  probe "frontend /          " "http://localhost:${FRONTEND_PORT}/"
  probe "openwebui /health   " "http://localhost:${OPENWEBUI_PORT}/health"
  probe "n8n /healthz        " "http://localhost:${N8N_PORT}/healthz"

  # CORS preflight: backend must accept the frontend's origin
  hdr "CORS preflight (frontend origin -> backend)"
  origin="http://${APP_HOST}:${FRONTEND_PORT}"
  cors_hdr=$(curl -s -m 5 -o /dev/null -D - \
    -H "Origin: ${origin}" \
    -H "Access-Control-Request-Method: GET" \
    -X OPTIONS "http://localhost:${BACKEND_PORT}/jobs" 2>/dev/null \
    | tr -d '\r' | awk -F': ' '/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin/ {print $2}')
  if [[ "$cors_hdr" == "$origin" || "$cors_hdr" == "*" ]]; then
    ok "backend allows Origin: ${origin}  (got: ${cors_hdr})"
  else
    bad "backend does NOT allow Origin: ${origin}  (got: '${cors_hdr:-<none>}') — fix CORS_ORIGINS in .env"
  fi

  # 5. Postgres databases + pgvector extension
  hdr "Postgres"
  PSQL="$DC exec -T postgres psql -U ${POSTGRES_USER} -tAc"
  if ! $DC ps postgres 2>/dev/null | grep -q .; then
    bad "postgres container not running"
  else
    for db in "${POSTGRES_DB}" "${OPENWEBUI_DB}" "${N8N_DB}"; do
      exists=$($PSQL "SELECT 1 FROM pg_database WHERE datname='${db}'" postgres 2>/dev/null | tr -d '[:space:]')
      if [[ "$exists" == "1" ]]; then
        ok "database '${db}' exists"
      else
        bad "database '${db}' MISSING — wipe with: $DC down -v && $DC up -d"
      fi
    done
    ext=$($PSQL "SELECT extname FROM pg_extension WHERE extname='vector'" "${OPENWEBUI_DB}" 2>/dev/null | tr -d '[:space:]')
    if [[ "$ext" == "vector" ]]; then
      ok "pgvector extension installed on '${OPENWEBUI_DB}'"
    else
      bad "pgvector extension NOT installed on '${OPENWEBUI_DB}' — wipe with: $DC down -v && $DC up -d"
    fi
  fi

  # summary
  echo
  if (( FAIL == 0 )); then
    echo "${GRN}All checks passed (${PASS}/${PASS}).${RST}"
    return 0
  else
    echo "${RED}${FAIL} check(s) failed${RST}, ${GRN}${PASS} passed${RST}."
    return 1
  fi
}

if [[ "${1:-}" == "--watch" ]]; then
  while true; do
    clear
    run_once
    sleep 5
  done
else
  run_once
fi
