import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import JobApplication
from ..schemas.job import JobCreate, JobRead, JobUpdate

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=list[JobRead])
def list_jobs(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> list[JobApplication]:
    query = db.query(JobApplication)
    if status_filter:
        query = query.filter(JobApplication.status == status_filter)
    return query.order_by(JobApplication.created_at.desc()).all()


@router.post("", response_model=JobRead, status_code=status.HTTP_201_CREATED)
def create_job(payload: JobCreate, db: Session = Depends(get_db)) -> JobApplication:
    job = JobApplication(**payload.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: uuid.UUID, db: Session = Depends(get_db)) -> JobApplication:
    job = db.get(JobApplication, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.patch("/{job_id}", response_model=JobRead)
def update_job(
    job_id: uuid.UUID, payload: JobUpdate, db: Session = Depends(get_db)
) -> JobApplication:
    job = db.get(JobApplication, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(job, key, value)
    db.commit()
    db.refresh(job)
    return job


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    job = db.get(JobApplication, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
