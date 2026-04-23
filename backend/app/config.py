from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    mail_imap_host: str = os.getenv("MAIL_IMAP_HOST", "imap.exmail.qq.com")
    mail_imap_port: int = int(os.getenv("MAIL_IMAP_PORT", "993"))
    mail_username: str = os.getenv("MAIL_USERNAME", "")
    mail_password: str = os.getenv("MAIL_PASSWORD", "")
    mail_folder: str = os.getenv("MAIL_FOLDER", "INBOX")
    mail_source_keywords: list[str] = None  # type: ignore[assignment]
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    openai_timeout_seconds: int = int(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))
    database_path: Path = Path(os.getenv("DATABASE_PATH", "./backend/data/recruitment.db"))
    cors_allow_origins: list[str] = None  # type: ignore[assignment]
    log_level: str = os.getenv("LOG_LEVEL", "INFO")

    def __post_init__(self) -> None:
        object.__setattr__(self, "mail_source_keywords", _split_csv(os.getenv("MAIL_SOURCE_KEYWORDS", "zhaopin,zhaopinmail.com,智联招聘")))
        object.__setattr__(self, "cors_allow_origins", _split_csv(os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173")))
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def mail_configured(self) -> bool:
        return bool(self.mail_username and self.mail_password)

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key)


settings = Settings()
