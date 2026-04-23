# Recruitment Screening Backend

FastAPI backend for the enterprise mailbox resume ingestion and OpenAI AI screening flow.

## Run

1. Create a virtual environment and install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend\requirements.txt
```

2. Copy `backend/.env.example` to `.env` at the repo root or export the same environment variables.

3. Start the API:

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## Core endpoints

- `GET /api/recruitment/health`
- `GET /api/recruitment/job-rules`
- `POST /api/recruitment/job-rules`
- `POST /api/recruitment/mail-sync/run`
- `GET /api/recruitment/candidates`
- `GET /api/recruitment/candidates/{id}`
