import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

JobStatus = Literal["saved", "applied", "interview", "rejected", "offer"]


class JobBase(BaseModel):
    company_name: str
    job_title: str
    job_url: str | None = None
    source: str | None = None
    status: JobStatus = "saved"
    score: int | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class JobCreate(JobBase):
    pass


class JobUpdate(BaseModel):
    company_name: str | None = None
    job_title: str | None = None
    job_url: str | None = None
    source: str | None = None
    status: JobStatus | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class JobRead(JobBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
