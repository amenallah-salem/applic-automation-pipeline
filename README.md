# applic-automation-pipeline

## Project structure

- `backend/` — backend service source code
- `frontend/` — frontend application source code
- `docker-compose.yaml` — Docker Compose configuration for running the stack

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+, bundled with modern Docker installs)

## Running with Docker Compose

From the repository root:

```bash
# Build and start all services in the foreground
docker compose up --build

# Or start in detached (background) mode
docker compose up --build -d
```

### Common commands

```bash
# View logs
docker compose logs -f

# Stop and remove containers, networks
docker compose down

# Stop and also remove volumes
docker compose down -v

# Rebuild a specific service
docker compose build <service-name>

# Restart a specific service
docker compose restart <service-name>
```
