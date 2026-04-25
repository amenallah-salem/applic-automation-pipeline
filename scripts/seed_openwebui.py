#!/usr/bin/env python3
"""
Seed an Open WebUI instance:
  * Create / reuse an admin account (the first signup is admin).
  * Create additional user accounts (idempotent — existing emails are skipped).
  * Configure OpenAI-compatible model endpoints. The first endpoint is Groq
    (https://api.groq.com/openai/v1), so Groq models show up first in the
    chat model picker.

The whole stack only depends on the Python standard library, so this works
inside any container or fresh venv without `pip install`.

Usage
-----
    # 1. simplest: defaults from env / .env, prompts for nothing
    GROQ_API_KEY=gsk_xxx ./scripts/seed_openwebui.py

    # 2. point at a remote Open WebUI
    ./scripts/seed_openwebui.py --url http://192.168.1.50:3001

    # 3. add extra users from a json file (list of {name,email,password,role?})
    ./scripts/seed_openwebui.py --users-file users.json

    # 4. add an extra OpenAI-compatible provider next to Groq
    OPENROUTER_API_KEY=sk-or-... ./scripts/seed_openwebui.py

Env vars (all optional except GROQ_API_KEY when you actually want Groq to work)
------------------------------------------------------------------------------
    OPENWEBUI_URL              default http://localhost:${OPENWEBUI_PORT:-3001}
    OPENWEBUI_ADMIN_NAME       default "Admin"
    OPENWEBUI_ADMIN_EMAIL      default "admin@local.test"
    OPENWEBUI_ADMIN_PASSWORD   default "ChangeMe!Admin1"
    GROQ_API_KEY               required for Groq to work; if missing a
                               placeholder is written and a warning printed
    GROQ_BASE_URL              default "https://api.groq.com/openai/v1"
    OPENROUTER_API_KEY         optional second provider
    OPENAI_API_KEY             optional third provider (real OpenAI)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# -- tiny .env loader (no python-dotenv dependency) -------------------------
def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


# -- HTTP helpers ----------------------------------------------------------
class HTTPError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


def http(
    method: str,
    url: str,
    *,
    token: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 10.0,
) -> dict[str, Any]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode() or "{}"
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        raise HTTPError(e.code, e.read().decode(errors="replace")) from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Cannot reach {url}: {e.reason}") from None


# -- domain types ----------------------------------------------------------
@dataclass
class User:
    name: str
    email: str
    password: str
    role: str = "user"  # "admin" | "user" | "pending"


@dataclass
class OpenAIEndpoint:
    name: str          # human label, used as prefix_id and tag
    base_url: str
    api_key: str
    enable: bool = True


@dataclass
class SeedConfig:
    base_url: str
    admin: User
    extra_users: list[User] = field(default_factory=list)
    endpoints: list[OpenAIEndpoint] = field(default_factory=list)


# -- core ops --------------------------------------------------------------
def get_admin_token(cfg: SeedConfig) -> str:
    """First try signin; if that fails (no user yet), do signup."""
    try:
        resp = http(
            "POST",
            f"{cfg.base_url}/api/v1/auths/signin",
            body={"email": cfg.admin.email, "password": cfg.admin.password},
        )
        print(f"[admin] signed in as {cfg.admin.email} ({resp.get('role')})")
        return resp["token"]
    except HTTPError as e:
        if e.status not in (400, 401, 403, 404):
            raise

    print(f"[admin] no existing admin, signing up {cfg.admin.email}")
    try:
        resp = http(
            "POST",
            f"{cfg.base_url}/api/v1/auths/signup",
            body={
                "name": cfg.admin.name,
                "email": cfg.admin.email,
                "password": cfg.admin.password,
            },
        )
    except HTTPError as e:
        raise RuntimeError(
            "Could not sign up the admin. Either signups are disabled "
            "(ENABLE_SIGNUP=false) or another user already owns this email "
            f"with a different password. Server said: {e.body}"
        ) from None

    if resp.get("role") != "admin":
        print(
            "[admin] WARNING: first signup did not become admin. "
            "Open WebUI may already have an admin with a different email."
        )
    return resp["token"]


def add_user(token: str, base_url: str, user: User) -> str:
    """Idempotent: returns 'created' | 'exists'."""
    try:
        http(
            "POST",
            f"{base_url}/api/v1/auths/add",
            token=token,
            body={
                "name": user.name,
                "email": user.email,
                "password": user.password,
                "role": user.role,
            },
        )
        return "created"
    except HTTPError as e:
        msg = e.body.lower()
        if e.status == 400 and ("taken" in msg or "exist" in msg):
            return "exists"
        raise


def configure_openai_endpoints(
    token: str, base_url: str, endpoints: list[OpenAIEndpoint]
) -> dict[str, Any]:
    """
    Replace the OpenAI-compatible connections list. Order matters: index 0
    shows up first in the model picker, so put Groq first.
    """
    payload: dict[str, Any] = {
        "ENABLE_OPENAI_API": bool(endpoints),
        "OPENAI_API_BASE_URLS": [e.base_url for e in endpoints],
        "OPENAI_API_KEYS": [e.api_key for e in endpoints],
        "OPENAI_API_CONFIGS": {
            str(i): {
                "enable": e.enable,
                "prefix_id": e.name,
                "tags": [{"name": e.name}],
            }
            for i, e in enumerate(endpoints)
        },
    }
    return http(
        "POST", f"{base_url}/openai/config/update", token=token, body=payload
    )


def list_openai_models(token: str, base_url: str) -> list[str]:
    """Best-effort: tries /openai/models. Network errors → []."""
    try:
        resp = http("GET", f"{base_url}/openai/models", token=token, timeout=20)
    except (HTTPError, RuntimeError):
        return []
    data = resp.get("data") if isinstance(resp, dict) else None
    if not isinstance(data, list):
        return []
    return [m.get("id", "?") for m in data if isinstance(m, dict)]


# -- config builders --------------------------------------------------------
DEFAULT_USERS = [
    User(name="Alice",   email="alice@local.test",   password="AlicePass123!"),
    User(name="Bob",     email="bob@local.test",     password="BobPass123!"),
    User(name="Charlie", email="charlie@local.test", password="CharliePass123!"),
]


def load_users_from_file(path: Path) -> list[User]:
    raw = json.loads(path.read_text())
    if not isinstance(raw, list):
        sys.exit(f"users file must be a JSON list, got {type(raw).__name__}")
    out: list[User] = []
    for i, item in enumerate(raw):
        try:
            out.append(
                User(
                    name=item["name"],
                    email=item["email"],
                    password=item["password"],
                    role=item.get("role", "user"),
                )
            )
        except (KeyError, TypeError) as e:
            sys.exit(f"users file entry #{i} is invalid: {e}")
    return out


def build_endpoints(args: argparse.Namespace) -> list[OpenAIEndpoint]:
    endpoints: list[OpenAIEndpoint] = []

    groq_key = args.groq_api_key or os.environ.get("GROQ_API_KEY", "")
    groq_url = (
        args.groq_base_url
        or os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    )
    if not groq_key:
        groq_key = "REPLACE_WITH_GROQ_API_KEY"
        print(
            "[groq] WARNING: GROQ_API_KEY is not set. Configuring Groq with a "
            "placeholder so it appears in the UI; set GROQ_API_KEY and re-run "
            "this script (or edit Settings → Connections in the UI) to make "
            "it work."
        )
    endpoints.append(
        OpenAIEndpoint(name="groq", base_url=groq_url, api_key=groq_key)
    )

    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openrouter_key:
        endpoints.append(
            OpenAIEndpoint(
                name="openrouter",
                base_url="https://openrouter.ai/api/v1",
                api_key=openrouter_key,
            )
        )

    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        endpoints.append(
            OpenAIEndpoint(
                name="openai",
                base_url="https://api.openai.com/v1",
                api_key=openai_key,
            )
        )

    return endpoints


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Seed an Open WebUI instance with users and an OpenAI-compatible "
            "Groq endpoint."
        )
    )
    p.add_argument(
        "--url",
        default=None,
        help="Open WebUI base URL (default: $OPENWEBUI_URL or "
        "http://localhost:${OPENWEBUI_PORT:-3001})",
    )
    p.add_argument(
        "--admin-name",
        default=os.environ.get("OPENWEBUI_ADMIN_NAME", "Admin"),
    )
    p.add_argument(
        "--admin-email",
        default=os.environ.get("OPENWEBUI_ADMIN_EMAIL", "admin@local.test"),
    )
    p.add_argument(
        "--admin-password",
        default=os.environ.get("OPENWEBUI_ADMIN_PASSWORD", "ChangeMe!Admin1"),
    )
    p.add_argument(
        "--users-file",
        type=Path,
        default=None,
        help="JSON file of [{name,email,password,role?}, ...] to add. "
        "If omitted, a small default set is created.",
    )
    p.add_argument("--groq-api-key", default=None)
    p.add_argument("--groq-base-url", default=None)
    p.add_argument(
        "--skip-models",
        action="store_true",
        help="Only create accounts; don't touch OpenAI connections.",
    )
    return p.parse_args(argv)


# -- main ------------------------------------------------------------------
def main(argv: list[str]) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")
    args = parse_args(argv)

    base_url = args.url or os.environ.get("OPENWEBUI_URL")
    if not base_url:
        port = os.environ.get("OPENWEBUI_PORT", "3001")
        base_url = f"http://localhost:{port}"
    base_url = base_url.rstrip("/")

    cfg = SeedConfig(
        base_url=base_url,
        admin=User(
            name=args.admin_name,
            email=args.admin_email,
            password=args.admin_password,
            role="admin",
        ),
        extra_users=(
            load_users_from_file(args.users_file)
            if args.users_file
            else DEFAULT_USERS
        ),
        endpoints=[] if args.skip_models else build_endpoints(args),
    )

    print(f"[init] target: {cfg.base_url}")

    token = get_admin_token(cfg)

    print(f"[users] adding {len(cfg.extra_users)} user(s)")
    for u in cfg.extra_users:
        outcome = add_user(token, cfg.base_url, u)
        print(f"  - {u.email:<30} {outcome:<7} ({u.role})")

    if cfg.endpoints:
        print(f"[models] configuring {len(cfg.endpoints)} OpenAI-compatible endpoint(s)")
        configure_openai_endpoints(token, cfg.base_url, cfg.endpoints)
        for i, e in enumerate(cfg.endpoints):
            redacted = (e.api_key[:6] + "…") if len(e.api_key) > 6 else "(empty)"
            print(f"  [{i}] {e.name:<10} {e.base_url:<45} key={redacted}")

        models = list_openai_models(token, cfg.base_url)
        if models:
            print(f"[models] discovered {len(models)} model(s):")
            for m in models[:15]:
                print(f"  - {m}")
            if len(models) > 15:
                print(f"  ... and {len(models) - 15} more")
        else:
            print(
                "[models] could not list models (network blocked, bad key, or "
                "Open WebUI still warming up)."
            )

    print()
    print("== Summary ==")
    print(f"  Admin login: {cfg.admin.email} / {cfg.admin.password}")
    for u in cfg.extra_users:
        print(f"  User login : {u.email} / {u.password}")
    print(f"  Web UI     : {cfg.base_url}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
