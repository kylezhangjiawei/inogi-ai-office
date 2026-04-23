# INOGI API

Unified backend for the INOGI AI Office System built with NestJS, TypeScript, Prisma, and PostgreSQL.

## Run locally

1. Copy `.env.example` to `.env`
2. Install dependencies
3. Generate Prisma client
4. Run migrations
5. Start the API

```powershell
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

## Initial modules

- `health`
- `users`
- `roles`
- `system-settings`
- `resume-screening`
