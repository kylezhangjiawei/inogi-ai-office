
# INOGI AI Office System

This is a code bundle for INOGI AI Office System. The original project is available at https://www.figma.com/design/mRq2O4qhlP8NpQJE2SZF5X/INOGI-AI-Office-System.

## Tech Stack

### Frontend

- React 18
- Vite 6
- TypeScript
- Tailwind CSS 4
- React Router 7
- Radix UI component primitives
- MUI / Emotion
- lucide-react icons
- motion animations
- Recharts charts
- sonner toast notifications

### Backend

- Node.js
- NestJS 11
- TypeScript
- REST API with `/api` prefix
- Passport + JWT authentication
- argon2 password hashing
- class-validator / class-transformer DTO validation
- Nest Schedule jobs
- Nest Throttler rate limiting

The backend service lives in `apps/api`.

### Database and ORM

- PostgreSQL
- Prisma 6
- Prisma migrations
- `DATABASE_URL` environment variable for database connectivity

Prisma schema and migrations live in `apps/api/prisma`.

### AI and Integrations

- OpenAI SDK
- Qwen / DashScope-compatible provider configuration
- Tencent OCR integration
- WeCom approval and callback integration
- IMAP email ingestion with mailparser
- PDF and Word document parsing through `pdf-parse` and `mammoth`

## Project Structure

- `src/app` - frontend application code
- `apps/api` - NestJS backend API
- `apps/api/src/modules/research-development` - research and development task module
- `apps/api/prisma/schema.prisma` - Prisma database schema
- `deploy/postgres` - PostgreSQL deployment assets

## Running the Code

Install dependencies:

```powershell
npm i
```

Start the full local development stack:

```powershell
npm run dev
```

Start frontend only:

```powershell
npm run dev:web
```

Start backend only:

```powershell
npm --prefix apps/api run start:dev
```

Build frontend:

```powershell
npm run build
```

Build backend:

```powershell
npm --prefix apps/api run build
```
