from __future__ import annotations

import json
import time
from typing import Any

from openai import OpenAI

from ..config import settings
from ..schemas import CandidateProfile, ScreeningResult


PROMPT_VERSION = "resume-screening-v2"

SCREENING_SCHEMA_DESC = (
    '{"score": integer 0-100, "decision": "recommend"|"hold"|"reject", '
    '"matched_points": [string, ...], "risks": [string, ...], '
    '"summary": string, "next_step": boolean}'
)


def build_screening_payload(profile: CandidateProfile, jd_text: str) -> dict[str, Any]:
    return {
        "candidate_profile": profile.model_dump(),
        "raw_email_excerpt": profile.raw_text[:2500],
        "job_description": jd_text,
        "task": "Evaluate the candidate against the job description and return strict JSON only.",
    }


class ScreeningService:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        effective_api_key = api_key or settings.openai_api_key
        effective_base_url = base_url or settings.openai_base_url or None
        self._model = model or settings.openai_model
        self._client = (
            OpenAI(
                api_key=effective_api_key,
                base_url=effective_base_url,
                timeout=settings.openai_timeout_seconds,
            )
            if effective_api_key
            else None
        )

    @property
    def configured(self) -> bool:
        return self._client is not None

    def evaluate(self, profile: CandidateProfile, jd_text: str) -> tuple[ScreeningResult, dict[str, Any], int]:
        if self._client is None:
            raise RuntimeError("AI API key is not configured.")

        request_payload = build_screening_payload(profile, jd_text)
        started = time.perf_counter()
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a conservative enterprise recruiting screener. "
                        "Score only against the provided job description and candidate information. "
                        f"Return strict JSON matching this schema exactly: {SCREENING_SCHEMA_DESC}"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(request_payload, ensure_ascii=False),
                },
            ],
            response_format={"type": "json_object"},
        )
        duration_ms = int((time.perf_counter() - started) * 1000)
        raw_output = response.choices[0].message.content
        parsed = json.loads(raw_output)
        return ScreeningResult.model_validate(parsed), {"raw_output": raw_output}, duration_ms
