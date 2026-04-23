from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Decision = Literal["recommend", "hold", "reject"]


class CandidateProfile(BaseModel):
    name: str = ""
    gender: str = ""
    birth_or_age: str = ""
    education: str = ""
    status: str = ""
    city: str = ""
    hukou: str = ""
    target_job: str = ""
    target_city: str = ""
    salary_expectation: str = ""
    recent_company: str = ""
    recent_title: str = ""
    years_experience: str = ""
    work_summary: str = ""
    language_skills: list[str] = Field(default_factory=list)
    email: str = ""
    phone: str = ""
    raw_text: str = ""


class ScreeningResult(BaseModel):
    score: int = Field(ge=0, le=100)
    decision: Decision
    matched_points: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    summary: str
    next_step: bool


class JobRuleCreate(BaseModel):
    id: int | None = None
    name: str = Field(min_length=1, max_length=100)
    jd_text: str = Field(min_length=1)
    enabled: bool = True


class JobRuleResponse(JobRuleCreate):
    id: int
    created_at: str
    updated_at: str


class MailPreviewItem(BaseModel):
    subject: str
    sender_name: str
    sender_email: str
    received_at: str
    preview: str
    candidate_name: str
    status: str
    error_message: str | None = None


class MailSyncRequest(BaseModel):
    job_rule_id: int | None = None
    mail_config_id: str | None = None
    openai_config_id: str | None = None
    ignore_last_uid: bool = False
    since_hours: int = Field(default=72, ge=1, le=24 * 30)
    limit: int = Field(default=20, ge=1, le=100)


class MailSyncRunResult(BaseModel):
    processed: int
    created_candidates: int
    skipped: int
    failed: int
    latest_uid: int | None = None
    job_rule_id: int | None = None
    openai_model: str | None = None
    message: str
    mail_previews: list[MailPreviewItem] | None = None


class CandidateListItem(BaseModel):
    id: int
    job_rule_id: int | None = None
    job_rule_name: str | None = None
    name: str
    email: str
    phone: str
    city: str
    education: str
    target_job: str
    received_at: str
    source_subject: str
    score: int | None = None
    decision: Decision | None = None
    summary: str | None = None
    next_step: bool | None = None


class CandidateScreeningHistory(BaseModel):
    id: int
    score: int | None = None
    decision: Decision | None = None
    matched_points: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    summary: str | None = None
    next_step: bool | None = None
    status: str
    error_message: str | None = None
    model_name: str
    prompt_version: str
    created_at: str
    duration_ms: int | None = None


class CandidateDetail(BaseModel):
    id: int
    job_rule_id: int | None = None
    job_rule_name: str | None = None
    source_subject: str
    source_sender_name: str
    source_sender_email: str
    received_at: str
    raw_email_text: str
    parsed_candidate_profile: CandidateProfile
    screenings: list[CandidateScreeningHistory] = Field(default_factory=list)


# Integration config schemas

class MailConfigResponse(BaseModel):
    id: str
    kind: Literal["mail"] = "mail"
    name: str
    email: str
    imap_host: str
    imap_port: int
    enabled: bool
    created_at: str
    updated_at: str


class OpenAiConfigResponse(BaseModel):
    id: str
    kind: Literal["openai"] = "openai"
    name: str
    model: str
    base_url: str
    enabled: bool
    created_at: str
    updated_at: str


class SaveMailConfigPayload(BaseModel):
    id: str | None = None
    name: str = Field(default="", max_length=100)
    email: str
    imap_host: str = "imap.exmail.qq.com"
    imap_port: int = 993
    encrypted_secret: str | None = None
    enabled: bool = True


class SaveOpenAiConfigPayload(BaseModel):
    id: str | None = None
    name: str = Field(default="", max_length=100)
    model: str
    base_url: str = ""
    encrypted_secret: str | None = None
    enabled: bool = True


# Mail sync schedule schemas

class MailSyncSchedule(BaseModel):
    enabled: bool
    run_at: str
    since_hours: int
    limit: int
    job_rule_id: str | None = None
    mail_config_id: str | None = None
    openai_config_id: str | None = None
    last_run_at: str | None = None
    last_run_result: str | None = None


class SaveMailSyncSchedulePayload(BaseModel):
    enabled: bool
    run_at: str
    since_hours: int = Field(default=72, ge=1, le=24 * 30)
    limit: int = Field(default=20, ge=1, le=100)
    job_rule_id: str | None = None
    mail_config_id: str | None = None
    openai_config_id: str | None = None
