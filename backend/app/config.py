from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore"
    )

    database_url: str = (
        "postgresql+psycopg://postgres:postgres@postgres:5432/applications"
    )
    openwebui_url: str = "http://openwebui:8080"
    cors_origins: list[str] = ["http://localhost:3000"]


settings = Settings()
