from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/n8n")
async def n8n_webhook(request: Request) -> dict[str, Any]:
    """Placeholder webhook endpoint for n8n workflows.

    n8n can POST to ``http://backend:8000/webhooks/n8n`` from inside the
    compose network (or ``http://localhost:8000/webhooks/n8n`` from the host).
    Extend this handler to dispatch events into your own business logic.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = None
    return {"received": True, "payload": payload}
