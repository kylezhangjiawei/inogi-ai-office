# PostgreSQL Deployment

This project uses PostgreSQL together with Prisma migrations from `apps/api`.

## 1. Start PostgreSQL on the server

Copy the environment template and replace the placeholder password:

```bash
cp .env.example .env
```

Then start PostgreSQL:

```bash
docker compose --env-file .env -f compose.yaml up -d
```

The default configuration only binds PostgreSQL to `127.0.0.1`, which is safer when the API runs on the same server.

## 2. Point the API to the server database

Set `apps/api/.env` on the server to a production connection string like:

```env
DATABASE_URL="postgresql://inogi_admin:replace-with-a-strong-password@127.0.0.1:5432/inogi_ai_office?schema=public"
```

## 3. Apply Prisma migrations

Run these commands from `apps/api` on the server:

```bash
npm install
npm run prisma:generate
npm run prisma:deploy
```

`prisma migrate deploy` is the production-safe command. It applies the checked-in migrations without opening Prisma's local development workflow.

## 4. Optional: create the initial admin user

Only run the seed after setting admin credentials in the environment:

```env
SEED_ADMIN_NAME="System Administrator"
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_PASSWORD="replace-with-a-strong-password"
SEED_ADMIN_ROLE_NAME="Super Admin"
SEED_ADMIN_ROLE_DESCRIPTION="Full system access."
```

Then run:

```bash
npm run prisma:seed
```

If `SEED_ADMIN_PASSWORD` is not set, the seed script skips admin creation.

## 5. Verify

Useful checks:

```bash
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail=100
```

You can also verify Prisma connectivity from `apps/api`:

```bash
npx prisma migrate status
```
