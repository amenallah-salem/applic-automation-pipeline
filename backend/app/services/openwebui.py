from __future__ import annotations

from ..config import settings


class OpenWebUIClient:
    """Placeholder client for OpenWebUI integration.

    The real implementation should POST to the OpenWebUI chat-completions API
    (``{base_url}/api/chat/completions``) with an auth token and the selected
    model. For now, ``generate`` returns a templated string so the rest of the
    pipeline can be wired up end-to-end.
    """

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or settings.openwebui_url

    def generate(
        self,
        *,
        doc_type: str,
        job_title: str,
        company_name: str,
        prompt: str | None = None,
    ) -> str:
        extra = f"\n\nUser prompt: {prompt}" if prompt else ""
        return (
            f"[PLACEHOLDER {doc_type.upper()}] for '{job_title}' at "
            f"'{company_name}'. Replace this with a real OpenWebUI call at "
            f"{self.base_url}.{extra}"
        )
