from __future__ import annotations

import re

from ..schemas import CandidateProfile


NAME_LABELS = r"(?:\u59d3\u540d|\u5019\u9009\u4eba|\u5e94\u8058\u4eba)"
MALE = "\u7537"
FEMALE = "\u5973"
COLON = r"[:\uFF1A]"
LANGUAGE_PATTERN = (
    r"(\u82f1\u8bed|\u65e5\u8bed|\u97e9\u8bed|\u5fb7\u8bed|\u6cd5\u8bed|"
    r"\u897f\u73ed\u7259\u8bed|\u4fc4\u8bed|\u7ca4\u8bed)"
)


def clean_text(text: str) -> str:
    text = text.replace("\xa0", " ").replace("\u3000", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _search(patterns: list[str], text: str) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return clean_text(match.group(1))
    return ""


def _find_name(text: str) -> str:
    patterns = [
        rf"{NAME_LABELS}{COLON}\s*([^\n|]{{2,20}})",
        r"([^\s]{2,8})(?:\u5148\u751f|\u5973\u58eb)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return clean_text(match.group(1))
    return ""


def _find_languages(text: str) -> list[str]:
    found = re.findall(LANGUAGE_PATTERN, text)
    return list(dict.fromkeys(found))


def extract_candidate_profile(text: str, sender_email: str = "") -> CandidateProfile:
    normalized = clean_text(text)
    email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", normalized, re.IGNORECASE)
    phone_match = re.search(r"(1[3-9]\d{9})", normalized)
    years_match = re.search(r"(\d+(?:\.\d+)?\u5e74(?:\u5de5\u4f5c)?\u7ecf\u9a8c)", normalized)
    work_summary = _search(
        [
            rf"(?:\u5de5\u4f5c\u7ecf\u5386|\u5de5\u4f5c\u63cf\u8ff0|\u5de5\u4f5c\u6982\u8ff0|\u4e2a\u4eba\u603b\u7ed3){COLON}\s*([\s\S]{{0,240}})",
        ],
        normalized,
    )
    work_summary = work_summary.split("\u6559\u80b2\u7ecf\u5386")[0][:240]

    return CandidateProfile(
        name=_find_name(normalized),
        gender=_search([rf"(?:\u6027\u522b){COLON}\s*({MALE}|{FEMALE})"], normalized),
        birth_or_age=_search([rf"(?:\u5e74\u9f84|\u51fa\u751f\u65e5\u671f|\u51fa\u751f\u5e74\u6708){COLON}\s*([^\n|]{{2,20}})"], normalized),
        education=_search(
            [
                rf"(?:\u5b66\u5386|\u6700\u9ad8\u5b66\u5386|\u6559\u80b2\u80cc\u666f){COLON}\s*([^\n|]{{2,30}})",
                r"(\u535a\u58eb|\u7855\u58eb|\u672c\u79d1|\u5927\u4e13|\u4e2d\u4e13|\u9ad8\u4e2d)",
            ],
            normalized,
        ),
        status=_search([rf"(?:\u6c42\u804c\u72b6\u6001|\u76ee\u524d\u72b6\u6001){COLON}\s*([^\n|]{{2,40}})"], normalized),
        city=_search([rf"(?:\u73b0\u5c45\u4f4f\u5730|\u73b0\u5c45\u5730|\u6240\u5728\u5730|\u5c45\u4f4f\u5730){COLON}\s*([^\n|]{{2,40}})"], normalized),
        hukou=_search([rf"(?:\u6237\u53e3|\u6237\u7c4d){COLON}\s*([^\n|]{{2,40}})"], normalized),
        target_job=_search([rf"(?:\u6c42\u804c\u610f\u5411|\u5e94\u8058\u5c97\u4f4d|\u76ee\u6807\u5c97\u4f4d){COLON}\s*([^\n|]{{2,60}})"], normalized),
        target_city=_search([rf"(?:\u610f\u5411\u57ce\u5e02|\u76ee\u6807\u57ce\u5e02|\u671f\u671b\u57ce\u5e02){COLON}\s*([^\n|]{{2,40}})"], normalized),
        salary_expectation=_search([rf"(?:\u671f\u671b\u85aa\u8d44|\u85aa\u8d44\u8981\u6c42|\u671f\u671b\u6708\u85aa){COLON}\s*([^\n|]{{2,40}})"], normalized),
        recent_company=_search([rf"(?:\u6700\u8fd1\u516c\u53f8|\u6700\u8fd1\u4efb\u804c\u516c\u53f8|\u73b0\u4efb\u516c\u53f8){COLON}\s*([^\n|]{{2,80}})"], normalized),
        recent_title=_search([rf"(?:\u6700\u8fd1\u804c\u4f4d|\u6700\u8fd1\u5c97\u4f4d|\u73b0\u4efb\u804c\u4f4d){COLON}\s*([^\n|]{{2,80}})"], normalized),
        years_experience=clean_text(years_match.group(1)) if years_match else "",
        work_summary=work_summary,
        language_skills=_find_languages(normalized),
        email=email_match.group(0) if email_match else sender_email,
        phone=phone_match.group(1) if phone_match else "",
        raw_text=normalized,
    )


def should_attempt_screening(profile: CandidateProfile) -> tuple[bool, str | None]:
    if not profile.raw_text or len(profile.raw_text) < 40:
        return False, "Email body is too short to build a candidate profile."
    if not profile.name and not profile.target_job and not profile.email:
        return False, "No candidate name, target job, or email was extracted."
    return True, None
