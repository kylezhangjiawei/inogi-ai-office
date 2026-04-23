from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import settings


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dict_factory(cursor: sqlite3.Cursor, row: sqlite3.Row) -> dict[str, Any]:
    return {column[0]: row[index] for index, column in enumerate(cursor.description)}


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = _dict_factory
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connect() as connection:
            cursor = connection.cursor()
            cursor.executescript(
                """
                CREATE TABLE IF NOT EXISTS job_rule (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    jd_text TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS email_ingestion_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mailbox TEXT NOT NULL,
                    imap_uid INTEGER,
                    message_id TEXT,
                    unique_key TEXT NOT NULL UNIQUE,
                    subject TEXT NOT NULL,
                    sender_name TEXT NOT NULL,
                    sender_email TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    candidate_id INTEGER,
                    error_message TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS candidate (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    unique_key TEXT NOT NULL UNIQUE,
                    job_rule_id INTEGER,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    city TEXT NOT NULL,
                    education TEXT NOT NULL,
                    status TEXT NOT NULL,
                    target_job TEXT NOT NULL,
                    target_city TEXT NOT NULL,
                    salary_expectation TEXT NOT NULL,
                    recent_company TEXT NOT NULL,
                    recent_title TEXT NOT NULL,
                    years_experience TEXT NOT NULL,
                    raw_email_text TEXT NOT NULL,
                    parsed_candidate_profile TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    source_subject TEXT NOT NULL,
                    source_sender_name TEXT NOT NULL,
                    source_sender_email TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS candidate_screening (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    candidate_id INTEGER NOT NULL,
                    job_rule_id INTEGER,
                    prompt_version TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    request_payload TEXT NOT NULL,
                    response_payload TEXT NOT NULL,
                    score INTEGER,
                    decision TEXT,
                    matched_points TEXT NOT NULL,
                    risks TEXT NOT NULL,
                    summary TEXT,
                    next_step INTEGER,
                    duration_ms INTEGER,
                    status TEXT NOT NULL,
                    error_message TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runtime_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS integration_config (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    email TEXT,
                    imap_host TEXT,
                    imap_port INTEGER,
                    model TEXT,
                    base_url TEXT,
                    encrypted_secret TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS mail_sync_schedule (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    run_at TEXT NOT NULL DEFAULT '09:00',
                    since_hours INTEGER NOT NULL DEFAULT 72,
                    limit_count INTEGER NOT NULL DEFAULT 20,
                    job_rule_id TEXT,
                    mail_config_id TEXT,
                    openai_config_id TEXT,
                    last_run_at TEXT,
                    last_run_result TEXT,
                    updated_at TEXT NOT NULL
                );
                """
            )

    # ── job rules ──────────────────────────────────────────────────────────

    def list_job_rules(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return connection.execute(
                "SELECT id, name, jd_text, enabled, created_at, updated_at FROM job_rule ORDER BY updated_at DESC"
            ).fetchall()

    def save_job_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            if payload.get("id"):
                connection.execute(
                    """
                    UPDATE job_rule
                    SET name = ?, jd_text = ?, enabled = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (payload["name"], payload["jd_text"], int(payload["enabled"]), now, payload["id"]),
                )
                row_id = payload["id"]
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO job_rule (name, jd_text, enabled, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (payload["name"], payload["jd_text"], int(payload["enabled"]), now, now),
                )
                row_id = int(cursor.lastrowid)
            row = connection.execute(
                "SELECT id, name, jd_text, enabled, created_at, updated_at FROM job_rule WHERE id = ?",
                (row_id,),
            ).fetchone()
            return row

    def get_job_rule(self, job_rule_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            return connection.execute(
                "SELECT id, name, jd_text, enabled, created_at, updated_at FROM job_rule WHERE id = ?",
                (job_rule_id,),
            ).fetchone()

    def get_active_job_rule(self) -> dict[str, Any] | None:
        with self.connect() as connection:
            return connection.execute(
                """
                SELECT id, name, jd_text, enabled, created_at, updated_at
                FROM job_rule
                WHERE enabled = 1
                ORDER BY updated_at DESC
                LIMIT 1
                """
            ).fetchone()

    def delete_job_rule(self, job_rule_id: int) -> None:
        with self.connect() as connection:
            connection.execute("DELETE FROM job_rule WHERE id = ?", (job_rule_id,))

    # ── runtime state ──────────────────────────────────────────────────────

    def get_runtime_state(self, key: str) -> str | None:
        with self.connect() as connection:
            row = connection.execute("SELECT value FROM runtime_state WHERE key = ?", (key,)).fetchone()
            return None if row is None else str(row["value"])

    def set_runtime_state(self, key: str, value: str) -> None:
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO runtime_state (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, value, now),
            )

    # ── email ingestion ────────────────────────────────────────────────────

    def log_ingestion(
        self,
        *,
        mailbox: str,
        imap_uid: int | None,
        message_id: str,
        unique_key: str,
        subject: str,
        sender_name: str,
        sender_email: str,
        received_at: str,
        status: str,
        candidate_id: int | None = None,
        error_message: str | None = None,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO email_ingestion_log (
                    mailbox, imap_uid, message_id, unique_key, subject,
                    sender_name, sender_email, received_at, status, candidate_id,
                    error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    mailbox,
                    imap_uid,
                    message_id,
                    unique_key,
                    subject,
                    sender_name,
                    sender_email,
                    received_at,
                    status,
                    candidate_id,
                    error_message,
                    utc_now(),
                ),
            )

    def has_ingested_unique_key(self, unique_key: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT 1 AS found FROM email_ingestion_log WHERE unique_key = ? LIMIT 1",
                (unique_key,),
            ).fetchone()
            return row is not None

    # ── candidates ─────────────────────────────────────────────────────────

    def save_candidate(
        self,
        *,
        unique_key: str,
        job_rule_id: int | None,
        profile: dict[str, Any],
        raw_email_text: str,
        received_at: str,
        source_subject: str,
        source_sender_name: str,
        source_sender_email: str,
    ) -> int:
        now = utc_now()
        serialized_profile = json.dumps(profile, ensure_ascii=False)
        with self.connect() as connection:
            existing = connection.execute(
                "SELECT id FROM candidate WHERE unique_key = ?",
                (unique_key,),
            ).fetchone()
            params = (
                job_rule_id,
                profile.get("name", ""),
                profile.get("email", ""),
                profile.get("phone", ""),
                profile.get("city", ""),
                profile.get("education", ""),
                profile.get("status", ""),
                profile.get("target_job", ""),
                profile.get("target_city", ""),
                profile.get("salary_expectation", ""),
                profile.get("recent_company", ""),
                profile.get("recent_title", ""),
                profile.get("years_experience", ""),
                raw_email_text,
                serialized_profile,
                received_at,
                source_subject,
                source_sender_name,
                source_sender_email,
            )
            if existing:
                connection.execute(
                    """
                    UPDATE candidate
                    SET job_rule_id = ?, name = ?, email = ?, phone = ?, city = ?, education = ?,
                        status = ?, target_job = ?, target_city = ?, salary_expectation = ?,
                        recent_company = ?, recent_title = ?, years_experience = ?, raw_email_text = ?,
                        parsed_candidate_profile = ?, received_at = ?, source_subject = ?,
                        source_sender_name = ?, source_sender_email = ?, updated_at = ?
                    WHERE unique_key = ?
                    """,
                    (*params, now, unique_key),
                )
                return int(existing["id"])

            cursor = connection.execute(
                """
                INSERT INTO candidate (
                    unique_key, job_rule_id, name, email, phone, city, education, status, target_job,
                    target_city, salary_expectation, recent_company, recent_title, years_experience,
                    raw_email_text, parsed_candidate_profile, received_at, source_subject,
                    source_sender_name, source_sender_email, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (unique_key, *params, now, now),
            )
            return int(cursor.lastrowid)

    def save_screening(
        self,
        *,
        candidate_id: int,
        job_rule_id: int | None,
        prompt_version: str,
        model_name: str,
        request_payload: dict[str, Any],
        response_payload: dict[str, Any],
        score: int | None,
        decision: str | None,
        matched_points: list[str],
        risks: list[str],
        summary: str | None,
        next_step: bool | None,
        duration_ms: int | None,
        status: str,
        error_message: str | None,
    ) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO candidate_screening (
                    candidate_id, job_rule_id, prompt_version, model_name, request_payload,
                    response_payload, score, decision, matched_points, risks, summary,
                    next_step, duration_ms, status, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    candidate_id,
                    job_rule_id,
                    prompt_version,
                    model_name,
                    json.dumps(request_payload, ensure_ascii=False),
                    json.dumps(response_payload, ensure_ascii=False),
                    score,
                    decision,
                    json.dumps(matched_points, ensure_ascii=False),
                    json.dumps(risks, ensure_ascii=False),
                    summary,
                    None if next_step is None else int(next_step),
                    duration_ms,
                    status,
                    error_message,
                    utc_now(),
                ),
            )
            return int(cursor.lastrowid)

    def list_candidates(self, *, decision: str | None, min_score: int | None, job_rule_id: int | None) -> list[dict[str, Any]]:
        query = """
            SELECT
                c.id,
                c.job_rule_id,
                jr.name AS job_rule_name,
                c.name,
                c.email,
                c.phone,
                c.city,
                c.education,
                c.target_job,
                c.received_at,
                c.source_subject,
                s.score,
                s.decision,
                s.summary,
                s.next_step
            FROM candidate c
            LEFT JOIN job_rule jr ON jr.id = c.job_rule_id
            LEFT JOIN candidate_screening s ON s.id = (
                SELECT cs.id
                FROM candidate_screening cs
                WHERE cs.candidate_id = c.id
                ORDER BY cs.created_at DESC
                LIMIT 1
            )
            WHERE 1 = 1
        """
        params: list[Any] = []
        if decision:
            query += " AND s.decision = ?"
            params.append(decision)
        if min_score is not None:
            query += " AND COALESCE(s.score, 0) >= ?"
            params.append(min_score)
        if job_rule_id is not None:
            query += " AND c.job_rule_id = ?"
            params.append(job_rule_id)
        query += " ORDER BY c.received_at DESC, c.id DESC"
        with self.connect() as connection:
            return connection.execute(query, params).fetchall()

    def get_candidate_detail(self, candidate_id: int) -> dict[str, Any] | None:
        with self.connect() as connection:
            candidate = connection.execute(
                """
                SELECT
                    c.*,
                    jr.name AS job_rule_name
                FROM candidate c
                LEFT JOIN job_rule jr ON jr.id = c.job_rule_id
                WHERE c.id = ?
                """,
                (candidate_id,),
            ).fetchone()
            if candidate is None:
                return None
            screenings = connection.execute(
                """
                SELECT *
                FROM candidate_screening
                WHERE candidate_id = ?
                ORDER BY created_at DESC
                """,
                (candidate_id,),
            ).fetchall()
            candidate["screenings"] = screenings
            return candidate

    # ── integration configs ────────────────────────────────────────────────

    def list_integration_configs(self, kind: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return connection.execute(
                "SELECT * FROM integration_config WHERE kind = ? ORDER BY updated_at DESC",
                (kind,),
            ).fetchall()

    def get_integration_config(self, config_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            return connection.execute(
                "SELECT * FROM integration_config WHERE id = ?",
                (config_id,),
            ).fetchone()

    def save_integration_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        config_id = payload.get("id") or str(uuid.uuid4())
        with self.connect() as connection:
            existing = connection.execute(
                "SELECT id FROM integration_config WHERE id = ?", (config_id,)
            ).fetchone()
            if existing:
                fields = ["name", "email", "imap_host", "imap_port", "model", "base_url", "enabled", "updated_at"]
                values = [
                    payload.get("name", ""),
                    payload.get("email"),
                    payload.get("imap_host"),
                    payload.get("imap_port"),
                    payload.get("model"),
                    payload.get("base_url"),
                    int(payload.get("enabled", True)),
                    now,
                ]
                if payload.get("encrypted_secret"):
                    fields.append("encrypted_secret")
                    values.append(payload["encrypted_secret"])
                set_clause = ", ".join(f"{f} = ?" for f in fields)
                connection.execute(
                    f"UPDATE integration_config SET {set_clause} WHERE id = ?",
                    (*values, config_id),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO integration_config
                        (id, kind, name, email, imap_host, imap_port, model, base_url,
                         encrypted_secret, enabled, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        config_id,
                        payload["kind"],
                        payload.get("name", ""),
                        payload.get("email"),
                        payload.get("imap_host"),
                        payload.get("imap_port"),
                        payload.get("model"),
                        payload.get("base_url"),
                        payload.get("encrypted_secret"),
                        int(payload.get("enabled", True)),
                        now,
                        now,
                    ),
                )
            return connection.execute(
                "SELECT * FROM integration_config WHERE id = ?", (config_id,)
            ).fetchone()

    def delete_integration_config(self, config_id: str) -> bool:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM integration_config WHERE id = ?", (config_id,)
            )
            return cursor.rowcount > 0

    # ── mail sync schedule ─────────────────────────────────────────────────

    def get_mail_sync_schedule(self) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM mail_sync_schedule WHERE id = 1").fetchone()
            if row is None:
                return {
                    "enabled": False,
                    "run_at": "09:00",
                    "since_hours": 72,
                    "limit_count": 20,
                    "job_rule_id": None,
                    "mail_config_id": None,
                    "openai_config_id": None,
                    "last_run_at": None,
                    "last_run_result": None,
                }
            return row

    def save_mail_sync_schedule(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO mail_sync_schedule
                    (id, enabled, run_at, since_hours, limit_count, job_rule_id,
                     mail_config_id, openai_config_id, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    enabled = excluded.enabled,
                    run_at = excluded.run_at,
                    since_hours = excluded.since_hours,
                    limit_count = excluded.limit_count,
                    job_rule_id = excluded.job_rule_id,
                    mail_config_id = excluded.mail_config_id,
                    openai_config_id = excluded.openai_config_id,
                    updated_at = excluded.updated_at
                """,
                (
                    int(payload.get("enabled", False)),
                    payload.get("run_at", "09:00"),
                    payload.get("since_hours", 72),
                    payload.get("limit", 20),
                    payload.get("job_rule_id"),
                    payload.get("mail_config_id"),
                    payload.get("openai_config_id"),
                    now,
                ),
            )
            return connection.execute("SELECT * FROM mail_sync_schedule WHERE id = 1").fetchone()

    def update_schedule_last_run(self, last_run_at: str, last_run_result: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE mail_sync_schedule SET last_run_at = ?, last_run_result = ? WHERE id = 1",
                (last_run_at, last_run_result),
            )


db = Database(settings.database_path)
