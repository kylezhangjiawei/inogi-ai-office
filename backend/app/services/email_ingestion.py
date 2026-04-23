from __future__ import annotations

import email
import hashlib
import imaplib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import parsedate_to_datetime, parseaddr

from bs4 import BeautifulSoup

from ..config import settings


logger = logging.getLogger(__name__)


@dataclass
class IngestedMail:
    imap_uid: int | None
    message_id: str
    unique_key: str
    subject: str
    sender_name: str
    sender_email: str
    received_at: str
    content_text: str


def decode_mime_text(value: str | None) -> str:
    if not value:
        return ""
    parts = decode_header(value)
    decoded_parts: list[str] = []
    for payload, charset in parts:
        if isinstance(payload, bytes):
            for candidate in [charset, "utf-8", "gb18030", "gbk", "latin-1"]:
                if not candidate:
                    continue
                try:
                    decoded_parts.append(payload.decode(candidate, errors="ignore"))
                    break
                except LookupError:
                    continue
            else:
                decoded_parts.append(payload.decode("utf-8", errors="ignore"))
        else:
            decoded_parts.append(payload)
    return "".join(decoded_parts).strip()


def html_to_text(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "meta", "head", "title"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)


def extract_email_content(message: email.message.Message) -> tuple[str, str]:
    plain_text = ""
    html_text = ""
    if message.is_multipart():
        for part in message.walk():
            disposition = str(part.get("Content-Disposition", ""))
            if "attachment" in disposition.lower():
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset_candidates = [part.get_content_charset(), "utf-8", "gb18030", "gbk", "latin-1"]
            content = ""
            for charset in charset_candidates:
                if not charset:
                    continue
                try:
                    content = payload.decode(charset, errors="ignore")
                    break
                except LookupError:
                    continue
            content_type = part.get_content_type()
            if content_type == "text/plain" and not plain_text:
                plain_text = content
            if content_type == "text/html" and not html_text:
                html_text = content
    else:
        payload = message.get_payload(decode=True)
        if payload:
            charset = message.get_content_charset() or "utf-8"
            content = payload.decode(charset, errors="ignore")
            if message.get_content_type() == "text/html":
                html_text = content
            else:
                plain_text = content
    return plain_text.strip(), html_text.strip()


def is_target_mail(subject: str, sender_name: str, sender_email: str, text: str) -> bool:
    target = "\n".join([subject, sender_name, sender_email, text]).lower()
    return any(keyword.lower() in target for keyword in settings.mail_source_keywords)


class ImapMailIngestionService:
    def __init__(
        self,
        username: str | None = None,
        password: str | None = None,
        imap_host: str | None = None,
        imap_port: int | None = None,
    ) -> None:
        self.mailbox = settings.mail_folder
        self._username = username or settings.mail_username
        self._password = password or settings.mail_password
        self._imap_host = imap_host or settings.mail_imap_host
        self._imap_port = imap_port or settings.mail_imap_port

    def fetch_candidate_emails(
        self,
        *,
        since_hours: int,
        limit: int,
        last_uid: int | None,
    ) -> tuple[list[IngestedMail], int | None]:
        if not self._username or not self._password:
            raise RuntimeError("邮箱配置缺失，请先设置 MAIL_USERNAME 和 MAIL_PASSWORD")

        latest_uid = last_uid
        with imaplib.IMAP4_SSL(self._imap_host, self._imap_port) as client:
            client.login(self._username, self._password)
            client.select(self.mailbox)

            if last_uid is not None and last_uid > 0:
                search_criteria = f"(UID {last_uid + 1}:*)"
                status, data = client.uid("search", None, search_criteria)
            else:
                since_date = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).strftime("%d-%b-%Y")
                status, data = client.uid("search", None, "SINCE", since_date)

            if status != "OK":
                raise RuntimeError("IMAP 搜索失败")

            raw_uids = data[0].split()
            selected_uids = raw_uids[-limit:]
            mails: list[IngestedMail] = []
            for raw_uid in selected_uids:
                uid = int(raw_uid)
                latest_uid = uid if latest_uid is None else max(latest_uid, uid)
                fetch_status, fetch_data = client.uid("fetch", str(uid), "(RFC822)")
                if fetch_status != "OK" or not fetch_data or not fetch_data[0]:
                    logger.warning("Failed to fetch uid=%s", uid)
                    continue

                raw_email = fetch_data[0][1]
                message = email.message_from_bytes(raw_email)

                subject = decode_mime_text(message.get("Subject", ""))
                sender_name, sender_email = parseaddr(message.get("From", ""))
                sender_name = decode_mime_text(sender_name)
                plain_text, html_text = extract_email_content(message)
                content_text = plain_text or html_to_text(html_text)
                if not is_target_mail(subject, sender_name, sender_email, content_text):
                    continue

                message_id = decode_mime_text(message.get("Message-ID", "")) or f"uid-{uid}"
                received_header = message.get("Date")
                try:
                    received_at = parsedate_to_datetime(received_header).astimezone(timezone.utc).isoformat() if received_header else datetime.now(timezone.utc).isoformat()
                except (TypeError, ValueError, IndexError):
                    received_at = datetime.now(timezone.utc).isoformat()

                unique_key = hashlib.sha256(
                    f"{message_id}|{self.mailbox}|{received_at}".encode("utf-8")
                ).hexdigest()

                mails.append(
                    IngestedMail(
                        imap_uid=uid,
                        message_id=message_id,
                        unique_key=unique_key,
                        subject=subject,
                        sender_name=sender_name,
                        sender_email=sender_email,
                        received_at=received_at,
                        content_text=content_text,
                    )
                )

            return mails, latest_uid
