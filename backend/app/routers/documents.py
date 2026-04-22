import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import GeneratedDocument
from ..schemas.document import DocumentRead

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=list[DocumentRead])
def list_documents(
    job_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
) -> list[GeneratedDocument]:
    query = db.query(GeneratedDocument)
    if job_id is not None:
        query = query.filter(GeneratedDocument.job_id == job_id)
    return query.order_by(GeneratedDocument.created_at.desc()).all()


@router.get("/{document_id}", response_model=DocumentRead)
def get_document(
    document_id: uuid.UUID, db: Session = Depends(get_db)
) -> GeneratedDocument:
    doc = db.get(GeneratedDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc
