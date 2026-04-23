from __future__ import annotations

import base64
import json
import logging
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import db
from .schemas import (
    CandidateDetail,
    CandidateListItem,
    CandidateProfile,
    CandidateScreeningHistory,
    JobRuleCreate,
    JobRuleResponse,
    MailConfigResponse,
    MailSyncRequest,
    MailSyncRunResult,
    MailSyncSchedule,
    OpenAiConfigResponse,
    SaveMailConfigPayload,
    SaveMailSyncSchedulePayload,
    SaveOpenAiConfigPayload,
)
from .services.candidate_parser import extract_candidate_profile, should_attempt_screening
from .services.email_ingestion import ImapMailIngestionService
from .services.screening import PROMPT_VERSION, ScreeningService, build_screening_payload


logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)

app = FastAPI(title="INOGI Recruitment Screening API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── RSA key management ─────────────────────────────────────────────────────────

def _load_or_create_rsa_keypair() -> tuple[Any, Any]:
    stored_pem = db.get_runtime_state("rsa_private_key_pem")
    if stored_pem:
        private_key = serialization.load_pem_private_key(stored_pem.encode(), password=None)
    else:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ).decode()
        db.set_runtime_state("rsa_private_key_pem", pem)
    return private_key, private_key.public_key()


_rsa_private_key, _rsa_public_key = _load_or_create_rsa_keypair()


def _decrypt_secret(encrypted_b64: str) -> str:
    encrypted = base64.b64decode(encrypted_b64)
    return _rsa_private_key.decrypt(
        encrypted,
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    ).decode()


def _to_bool(value: Any) -> bool | None:
    if value is None:
        return None
    return bool(int(value))


# ── health ─────────────────────────────────────────────────────────────────────

@app.get("/api/recruitment/health")
def health() -> dict[str, Any]:
    mail_configs = db.list_integration_configs("mail")
    openai_configs = db.list_integration_configs("openai")
    return {
        "ok": True,
        "mail_configured": settings.mail_configured or any(c["enabled"] for c in mail_configs),
        "openai_configured": settings.openai_configured or any(c["enabled"] for c in openai_configs),
        "database_path": str(settings.database_path),
    }


# ── security ───────────────────────────────────────────────────────────────────

@app.get("/api/recruitment/security/public-key")
def get_public_key() -> dict[str, str]:
    pub_pem = _rsa_public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return {"algorithm": "RSA-OAEP", "public_key": pub_pem}


# ── integration configs ────────────────────────────────────────────────────────

@app.get("/api/recruitment/integrations/mail", response_model=list[MailConfigResponse])
def list_mail_configs() -> list[MailConfigResponse]:
    rows = db.list_integration_configs("mail")
    return [
        MailConfigResponse(
            id=r["id"],
            name=r["name"] or r.get("email", ""),
            email=r["email"] or "",
            imap_host=r["imap_host"] or settings.mail_imap_host,
            imap_port=r["imap_port"] or settings.mail_imap_port,
            enabled=bool(r["enabled"]),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]


@app.post("/api/recruitment/integrations/mail", response_model=MailConfigResponse)
def save_mail_config(payload: SaveMailConfigPayload) -> MailConfigResponse:
    secret = None
    if payload.encrypted_secret:
        try:
            secret = _decrypt_secret(payload.encrypted_secret)
        except Exception:
            raise HTTPException(status_code=400, detail="Failed to decrypt secret.")

    row = db.save_integration_config({
        "id": payload.id,
        "kind": "mail",
        "name": payload.name or payload.email,
        "email": payload.email,
        "imap_host": payload.imap_host,
        "imap_port": payload.imap_port,
        "encrypted_secret": secret,
        "enabled": payload.enabled,
    })
    return MailConfigResponse(
        id=row["id"],
        name=row["name"] or row.get("email", ""),
        email=row["email"] or "",
        imap_host=row["imap_host"] or settings.mail_imap_host,
        imap_port=row["imap_port"] or settings.mail_imap_port,
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@app.get("/api/recruitment/integrations/openai", response_model=list[OpenAiConfigResponse])
def list_openai_configs() -> list[OpenAiConfigResponse]:
    rows = db.list_integration_configs("openai")
    return [
        OpenAiConfigResponse(
            id=r["id"],
            name=r["name"] or r.get("model", ""),
            model=r["model"] or "",
            base_url=r["base_url"] or "",
            enabled=bool(r["enabled"]),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]


@app.post("/api/recruitment/integrations/openai", response_model=OpenAiConfigResponse)
def save_openai_config(payload: SaveOpenAiConfigPayload) -> OpenAiConfigResponse:
    secret = None
    if payload.encrypted_secret:
        try:
            secret = _decrypt_secret(payload.encrypted_secret)
        except Exception:
            raise HTTPException(status_code=400, detail="Failed to decrypt secret.")

    row = db.save_integration_config({
        "id": payload.id,
        "kind": "openai",
        "name": payload.name or payload.model,
        "model": payload.model,
        "base_url": payload.base_url,
        "encrypted_secret": secret,
        "enabled": payload.enabled,
    })
    return OpenAiConfigResponse(
        id=row["id"],
        name=row["name"] or row.get("model", ""),
        model=row["model"] or "",
        base_url=row["base_url"] or "",
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@app.delete("/api/recruitment/integrations/{config_id}")
def delete_integration_config(config_id: str) -> dict[str, str]:
    deleted = db.delete_integration_config(config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Config not found.")
    return {"id": config_id}


# ── job rules ──────────────────────────────────────────────────────────────────

@app.get("/api/recruitment/job-rules", response_model=list[JobRuleResponse])
def list_job_rules() -> list[JobRuleResponse]:
    rows = db.list_job_rules()
    return [JobRuleResponse.model_validate({**row, "enabled": bool(row["enabled"])}) for row in rows]


@app.post("/api/recruitment/job-rules", response_model=JobRuleResponse)
def save_job_rule(payload: JobRuleCreate) -> JobRuleResponse:
    row = db.save_job_rule(payload.model_dump())
    return JobRuleResponse.model_validate({**row, "enabled": bool(row["enabled"])})


@app.delete("/api/recruitment/job-rules/{job_rule_id}")
def delete_job_rule(job_rule_id: int) -> dict[str, int]:
    db.delete_job_rule(job_rule_id)
    return {"id": job_rule_id}


# ── mail sync schedule ─────────────────────────────────────────────────────────

@app.get("/api/recruitment/mail-sync/schedule", response_model=MailSyncSchedule)
def get_mail_sync_schedule() -> MailSyncSchedule:
    row = db.get_mail_sync_schedule()
    return MailSyncSchedule(
        enabled=bool(row["enabled"]),
        run_at=row["run_at"],
        since_hours=row["since_hours"],
        limit=row.get("limit_count", 20),
        job_rule_id=row.get("job_rule_id"),
        mail_config_id=row.get("mail_config_id"),
        openai_config_id=row.get("openai_config_id"),
        last_run_at=row.get("last_run_at"),
        last_run_result=row.get("last_run_result"),
    )


@app.post("/api/recruitment/mail-sync/schedule", response_model=MailSyncSchedule)
def save_mail_sync_schedule(payload: SaveMailSyncSchedulePayload) -> MailSyncSchedule:
    row = db.save_mail_sync_schedule(payload.model_dump())
    return MailSyncSchedule(
        enabled=bool(row["enabled"]),
        run_at=row["run_at"],
        since_hours=row["since_hours"],
        limit=row.get("limit_count", 20),
        job_rule_id=row.get("job_rule_id"),
        mail_config_id=row.get("mail_config_id"),
        openai_config_id=row.get("openai_config_id"),
        last_run_at=row.get("last_run_at"),
        last_run_result=row.get("last_run_result"),
    )


# ── mail sync run ──────────────────────────────────────────────────────────────

@app.post("/api/recruitment/mail-sync/run", response_model=MailSyncRunResult)
def run_mail_sync(payload: MailSyncRequest) -> MailSyncRunResult:
    job_rule = db.get_job_rule(payload.job_rule_id) if payload.job_rule_id else db.get_active_job_rule()
    if job_rule is None:
        raise HTTPException(status_code=400, detail="Please create and enable at least one job rule first.")

    # Resolve mail credentials
    mail_api_key: str | None = None
    mail_username = settings.mail_username
    mail_password = settings.mail_password
    mail_imap_host = settings.mail_imap_host
    mail_imap_port = settings.mail_imap_port

    if payload.mail_config_id:
        mail_cfg = db.get_integration_config(payload.mail_config_id)
        if mail_cfg:
            mail_username = mail_cfg.get("email") or mail_username
            mail_imap_host = mail_cfg.get("imap_host") or mail_imap_host
            mail_imap_port = mail_cfg.get("imap_port") or mail_imap_port
            if mail_cfg.get("encrypted_secret"):
                mail_password = mail_cfg["encrypted_secret"]

    # Resolve AI credentials
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str | None = None

    if payload.openai_config_id:
        ai_cfg = db.get_integration_config(payload.openai_config_id)
        if ai_cfg:
            openai_api_key = ai_cfg.get("encrypted_secret") or None
            openai_base_url = ai_cfg.get("base_url") or None
            openai_model = ai_cfg.get("model") or None

    ingestion_service = ImapMailIngestionService(
        username=mail_username,
        password=mail_password,
        imap_host=mail_imap_host,
        imap_port=mail_imap_port,
    )
    screening_service = ScreeningService(
        api_key=openai_api_key,
        base_url=openai_base_url,
        model=openai_model,
    )
    effective_model = screening_service._model

    mailbox = settings.mail_folder
    state_key = f"last_uid:{mailbox}:{payload.mail_config_id or 'default'}"
    last_uid = None
    if not payload.ignore_last_uid:
        last_uid_raw = db.get_runtime_state(state_key)
        last_uid = int(last_uid_raw) if last_uid_raw and last_uid_raw.isdigit() else None

    try:
        mails, latest_uid = ingestion_service.fetch_candidate_emails(
            since_hours=payload.since_hours,
            limit=payload.limit,
            last_uid=last_uid,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mail fetch failed: {exc}") from exc

    processed = 0
    created_candidates = 0
    skipped = 0
    failed = 0
    mail_previews = []

    for item in mails:
        if db.has_ingested_unique_key(item.unique_key):
            skipped += 1
            continue

        processed += 1
        profile = extract_candidate_profile(item.content_text, item.sender_email)
        can_screen, reason = should_attempt_screening(profile)
        preview_text = item.content_text[:200].replace("\n", " ")

        try:
            candidate_id = db.save_candidate(
                unique_key=item.unique_key,
                job_rule_id=job_rule["id"],
                profile=profile.model_dump(),
                raw_email_text=profile.raw_text,
                received_at=item.received_at,
                source_subject=item.subject,
                source_sender_name=item.sender_name,
                source_sender_email=item.sender_email,
            )
            created_candidates += 1

            if not can_screen:
                db.save_screening(
                    candidate_id=candidate_id,
                    job_rule_id=job_rule["id"],
                    prompt_version=PROMPT_VERSION,
                    model_name=effective_model,
                    request_payload=build_screening_payload(profile, job_rule["jd_text"]),
                    response_payload={},
                    score=None,
                    decision=None,
                    matched_points=[],
                    risks=[],
                    summary=None,
                    next_step=None,
                    duration_ms=None,
                    status="skipped",
                    error_message=reason,
                )
                db.log_ingestion(
                    mailbox=mailbox,
                    imap_uid=item.imap_uid,
                    message_id=item.message_id,
                    unique_key=item.unique_key,
                    subject=item.subject,
                    sender_name=item.sender_name,
                    sender_email=item.sender_email,
                    received_at=item.received_at,
                    status="skipped",
                    candidate_id=candidate_id,
                    error_message=reason,
                )
                skipped += 1
                mail_previews.append({
                    "subject": item.subject,
                    "sender_name": item.sender_name,
                    "sender_email": item.sender_email,
                    "received_at": item.received_at,
                    "preview": preview_text,
                    "candidate_name": profile.name,
                    "status": "skipped",
                    "error_message": reason,
                })
                continue

            if not screening_service.configured:
                pending_message = "AI API key is not configured. Candidate saved without screening."
                db.save_screening(
                    candidate_id=candidate_id,
                    job_rule_id=job_rule["id"],
                    prompt_version=PROMPT_VERSION,
                    model_name=effective_model,
                    request_payload=build_screening_payload(profile, job_rule["jd_text"]),
                    response_payload={},
                    score=None,
                    decision=None,
                    matched_points=[],
                    risks=[],
                    summary=None,
                    next_step=None,
                    duration_ms=None,
                    status="pending_config",
                    error_message=pending_message,
                )
                db.log_ingestion(
                    mailbox=mailbox,
                    imap_uid=item.imap_uid,
                    message_id=item.message_id,
                    unique_key=item.unique_key,
                    subject=item.subject,
                    sender_name=item.sender_name,
                    sender_email=item.sender_email,
                    received_at=item.received_at,
                    status="pending_config",
                    candidate_id=candidate_id,
                    error_message=pending_message,
                )
                mail_previews.append({
                    "subject": item.subject,
                    "sender_name": item.sender_name,
                    "sender_email": item.sender_email,
                    "received_at": item.received_at,
                    "preview": preview_text,
                    "candidate_name": profile.name,
                    "status": "pending_config",
                    "error_message": pending_message,
                })
                continue

            screening_result, response_payload, duration_ms = screening_service.evaluate(profile, job_rule["jd_text"])
            db.save_screening(
                candidate_id=candidate_id,
                job_rule_id=job_rule["id"],
                prompt_version=PROMPT_VERSION,
                model_name=effective_model,
                request_payload=build_screening_payload(profile, job_rule["jd_text"]),
                response_payload=response_payload,
                score=screening_result.score,
                decision=screening_result.decision,
                matched_points=screening_result.matched_points,
                risks=screening_result.risks,
                summary=screening_result.summary,
                next_step=screening_result.next_step,
                duration_ms=duration_ms,
                status="completed",
                error_message=None,
            )
            db.log_ingestion(
                mailbox=mailbox,
                imap_uid=item.imap_uid,
                message_id=item.message_id,
                unique_key=item.unique_key,
                subject=item.subject,
                sender_name=item.sender_name,
                sender_email=item.sender_email,
                received_at=item.received_at,
                status="completed",
                candidate_id=candidate_id,
                error_message=None,
            )
            mail_previews.append({
                "subject": item.subject,
                "sender_name": item.sender_name,
                "sender_email": item.sender_email,
                "received_at": item.received_at,
                "preview": preview_text,
                "candidate_name": profile.name,
                "status": "completed",
                "error_message": None,
            })

        except Exception as exc:
            failed += 1
            err_msg = str(exc)
            db.log_ingestion(
                mailbox=mailbox,
                imap_uid=item.imap_uid,
                message_id=item.message_id,
                unique_key=item.unique_key,
                subject=item.subject,
                sender_name=item.sender_name,
                sender_email=item.sender_email,
                received_at=item.received_at,
                status="failed",
                candidate_id=None,
                error_message=err_msg,
            )
            mail_previews.append({
                "subject": item.subject,
                "sender_name": item.sender_name,
                "sender_email": item.sender_email,
                "received_at": item.received_at,
                "preview": preview_text,
                "candidate_name": profile.name if profile else "",
                "status": "failed",
                "error_message": err_msg,
            })
            logger.exception("Failed to process candidate mail %s", item.unique_key)

    if latest_uid is not None:
        db.set_runtime_state(state_key, str(latest_uid))

    return MailSyncRunResult(
        processed=processed,
        created_candidates=created_candidates,
        skipped=skipped,
        failed=failed,
        latest_uid=latest_uid,
        job_rule_id=job_rule["id"],
        openai_model=effective_model,
        message=f"Processed {processed} matched emails.",
        mail_previews=mail_previews or None,
    )


# ── candidates ─────────────────────────────────────────────────────────────────

@app.get("/api/recruitment/candidates", response_model=list[CandidateListItem])
def list_candidates(
    decision: str | None = Query(default=None),
    min_score: int | None = Query(default=None, ge=0, le=100),
    job_rule_id: int | None = Query(default=None),
) -> list[CandidateListItem]:
    rows = db.list_candidates(decision=decision, min_score=min_score, job_rule_id=job_rule_id)
    return [
        CandidateListItem.model_validate(
            {
                **row,
                "next_step": _to_bool(row.get("next_step")),
            }
        )
        for row in rows
    ]


@app.get("/api/recruitment/candidates/{candidate_id}", response_model=CandidateDetail)
def get_candidate_detail(candidate_id: int) -> CandidateDetail:
    row = db.get_candidate_detail(candidate_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    screenings = [
        CandidateScreeningHistory.model_validate(
            {
                **screening,
                "matched_points": json.loads(screening["matched_points"] or "[]"),
                "risks": json.loads(screening["risks"] or "[]"),
                "next_step": _to_bool(screening.get("next_step")),
            }
        )
        for screening in row.pop("screenings", [])
    ]

    profile = CandidateProfile.model_validate(json.loads(row["parsed_candidate_profile"]))
    return CandidateDetail.model_validate(
        {
            **row,
            "parsed_candidate_profile": profile,
            "screenings": screenings,
        }
    )
