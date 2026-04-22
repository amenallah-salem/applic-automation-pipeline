import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

DocumentType = Literal["cv", "cover_letter", "message"]


class DocumentBase(BaseModel):
    type: DocumentType
    content: str


class DocumentRead(DocumentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    created_at: datetime


class GenerateRequest(BaseModel):
    job_id: uuid.UUID
    type: DocumentType
    prompt: str | None = None
