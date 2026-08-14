
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
- Built-in AI gateway control plane with priority, round-robin, weighted, and recent-lowest-latency routing
- Per-scene fallback chains, configurable circuit breaking, manual circuit reset, and request/attempt observability
- Unified non-streaming text routing for R&D structuring/briefs/reporting/performance/progress workflows, procurement parsing/material intelligence/ERP matching, translation, operations error analysis, external-document comparison, RAG answers, image prompt optimization, resume screening, and other utility completions
- Tencent OCR integration
- WeCom approval and callback integration
- IMAP email ingestion with mailparser
- PDF and Word document parsing through `pdf-parse` and `mammoth`

## Project Structure

- `src/app` - frontend application code
- `apps/api` - NestJS backend API
- `apps/api/src/modules/ai-gateway` - embedded AI routing, failover, circuit breaking, and observability control plane
- `apps/api/src/modules/research-development` - research and development task module
- `apps/api/prisma/schema.prisma` - Prisma database schema
- `deploy/postgres` - PostgreSQL deployment assets

## AI Gateway

The AI gateway is part of INOGI itself; it does not run as a separate service. Open
**AI 模型管理** in the application to manage connections, configure business-scene
routes, inspect request trends and error types, view circuit state, and drill into each
fallback attempt.

Each scene can choose one of four scheduling strategies:

- `priority` - use the configured connection order and fail over sequentially
- `round_robin` - rotate the first-choice connection per scene
- `weighted` - probabilistically choose the first connection by configured weights
- `lowest_latency` - prefer the connection with the lowest successful average latency during the last 30 days

The route also owns its timeout, consecutive-failure threshold, and circuit cooldown.
Circuit state is isolated by business scene and connection, while historical requests,
attempts, latency, Token usage, fallback behavior, and errors are persisted in PostgreSQL.
Configuration writes and manual circuit resets pass through the application's existing
audit interceptor.

Streaming chat, multimodal vision, image/video generation, embeddings, and file-upload
protocols stay on their dedicated paths because their request/response contracts are not
interchangeable with the gateway's non-streaming text-completion contract.

## Running the Code

**Node version.** Node 20 is enough to build and run the app, but the `test/*.spec.mts`
suite loads `.ts` sources directly and therefore needs Node's native type stripping,
which is on by default from **Node 22.18 / 23.6**. On older Node those 9 tests fail with
`ERR_UNKNOWN_FILE_EXTENSION`; `npm run test:ts` (60 tests) still runs everywhere.
The deploy script detects this and reports what it skipped instead of failing the build.

Install dependencies. This is a pnpm workspace: the version pins in `pnpm-workspace.yaml`
(`overrides`, `onlyBuiltDependencies`) are pnpm-only fields, and there is no
`package-lock.json`, so installing with npm silently produces a different dependency tree.

```powershell
corepack enable
pnpm install
```

Start the full local development stack:

```powershell
npm run dev
```

The local INOGI API uses port `3011` by default, while Vite serves the web app on
`5173`. This keeps INOGI separate from Intellifai, whose local frontend and BFF use
`5380` and `3000`. Override the INOGI API port with `INOGI_DEV_API_PORT` when needed.

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

Run the test suite (dev-tooling tests plus every backend `test/*.spec.{ts,mts}`):

```powershell
npm test
```

Typecheck both sides:

```powershell
npm run typecheck
npx tsc --noEmit -p apps/api/tsconfig.json
```

