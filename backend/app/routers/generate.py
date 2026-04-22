from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import GeneratedDocument, JobApplication
from ..schemas.document import DocumentRead, GenerateRequest
from ..services.openwebui import OpenWebUIClient

router = APIRouter(prefix="/generate", tags=["generate"])


@router.post("", response_model=DocumentRead)
def generate_document(
    payload: GenerateRequest, db: Session = Depends(get_db)
) -> GeneratedDocument:
    job = db.get(JobApplication, payload.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    client = OpenWebUIClient()
    content = client.generate(
        doc_type=payload.type,
        job_title=job.job_title,
        company_name=job.company_name,
        prompt=payload.prompt,
    )
    doc = GeneratedDocument(job_id=job.id, type=payload.type, content=content)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc
