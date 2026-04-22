from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .models import GeneratedDocument, JobApplication  # noqa: F401 -- register mappers
from .routers import documents, generate, jobs, webhooks


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Best-effort table creation; the SQL init script is the source of truth
    # when running via docker-compose, but this keeps local/dev runs working.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Applic Automation API",
    version="0.1.0",
    description="REST API for the AI-powered job-application agent.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(documents.router)
app.include_router(generate.router)
app.include_router(webhooks.router)


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    return {"service": "applic-automation-backend", "status": "ok"}


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "healthy"}
