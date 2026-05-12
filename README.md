# LendersHub

A multi-tenant SaaS platform for lending companies. Each tenant (lender) gets an isolated PostgreSQL schema, their own user base, and a branded portal. A super-admin panel manages tenants, subscriptions, and platform health.

## Architecture

```
frontend/   Next.js 16 (App Router, standalone output) — super-admin + tenant UI
backend/    NestJS 11 + Prisma 7 + PostgreSQL (Row-Level Security)
docker/     Dockerfiles for backend and frontend
```

**Key design decisions**

| Concern | Approach |
|---|---|
| Tenant isolation | Row-Level Security on `public` schema — `app.current_tenant_id` session variable |
| Super-admin bypass | Requests to `/api/v1/super-admin/*` set `app.bypass_rls = 'true'` per connection |
| Auth | JWT (NestJS Passport) + optional TOTP 2FA for super admins |
| Prisma 7 config | Connection URL lives in `backend/prisma.config.ts` (not in `schema.prisma`) |
| Frontend Docker | `output: "standalone"` — self-contained image, no separate `node_modules` copy |

---

## Prerequisites

| Tool | Version |
|---|---|
| Docker Desktop | latest |
| Node.js | 22.x (local dev only) |
| npm | 10.x (local dev only) |

---

## Option A — Full Docker (recommended)

Run the entire stack — PostgreSQL, Redis, backend, frontend — with one command. No local Node.js or database required.

### 1. Clone

```bash
git clone https://github.com/dhanapalan/LendersHub.git
cd LendersHub
```

### 2. Configure `.env`

The root `.env` is already committed with development defaults. For production, change at minimum:

```env
POSTGRES_PASSWORD=<strong-password>
JWT_SECRET=<64-char-random-string>
```

Current `.env` defaults (safe for local development):

```env
POSTGRES_DB=lendershub
POSTGRES_USER=postgres
POSTGRES_PASSWORD=devpass
JWT_SECRET=lendershub-super-secret-jwt-key-change-in-production-32chars
NEXT_PUBLIC_API_URL=http://localhost:4001
```

### 3. Build and start all services

```bash
docker compose up --build
```

First build takes ~5 minutes (Next.js compile is the longest step). Subsequent builds are faster due to Docker layer caching.

Services started:

| Service | Host port | URL |
|---|---|---|
| Frontend (Next.js) | 3000 | http://localhost:3000 |
| Backend (NestJS) | 4001 | http://localhost:4001 |
| PostgreSQL | 5433 | `postgresql://localhost:5433/lendershub` |
| Redis | 6380 | `redis://localhost:6380` |

The backend automatically runs `prisma migrate deploy` on every startup before NestJS boots.

### 4. Seed the super-admin (first run only)

```bash
docker compose exec backend sh -c "node -e \"require('./dist/prisma/seed');\""
```

Or with custom credentials:

```bash
docker compose exec \
  -e SUPER_ADMIN_EMAIL=you@company.com \
  -e SUPER_ADMIN_PASSWORD=Str0ng!Pass \
  backend sh -c "node -e \"require('./dist/prisma/seed');\""
```

Default credentials:
- Email: `admin@lendershub.com`
- Password: `Admin@LH2024!`

### 5. Log in

Open **http://localhost:3000/super-admin/login**

### Useful Docker commands

```bash
docker compose logs -f backend         # live backend logs
docker compose logs -f frontend        # live frontend logs
docker compose ps                      # container status
docker compose down                    # stop (data preserved)
docker compose down -v                 # stop + wipe all volumes
docker compose up --build backend      # rebuild only the backend
docker compose up --build frontend     # rebuild only the frontend
```

---

## Option B — Local Development (hot-reload)

Use this for active development with file watching.

### 1. Start infrastructure only

```bash
docker compose up db redis -d
```

This starts PostgreSQL on `localhost:5433` and Redis on `localhost:6380`.

### 2. Backend

```bash
cd backend
npm install
npx prisma migrate deploy
npm run seed
npm run start:dev
```

Backend runs on **http://localhost:4001** with hot-reload.

### 3. Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on **http://localhost:3000** with hot-reload.

### 4. Log in

Open **http://localhost:3000/super-admin/login**.

---

## Tenant Portal

Each tenant accesses their portal at:
- `/tenant/<subdomain>/login` — tenant login page
- `/tenant/<subdomain>/dashboard` — tenant dashboard
- `/<subdomain>/login` — subdomain-based routing (rewrites via Next.js middleware)

To create a tenant, log in as super-admin and go to **Tenants → New Tenant**.

---

## Environment Variable Reference

### Root `.env` (Docker Compose)

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_DB` | ✓ | Database name |
| `POSTGRES_USER` | ✓ | Database user |
| `POSTGRES_PASSWORD` | ✓ | Database password |
| `JWT_SECRET` | ✓ | Secret for signing JWTs — use a long random string |
| `NEXT_PUBLIC_API_URL` | ✓ | URL the browser uses to reach the backend (baked in at build time) |

### Backend (`backend/.env` for local dev)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | Full PostgreSQL connection string |
| `JWT_SECRET` | ✓ | Must match the root `.env` value |
| `PORT` | | HTTP port (default: `4001`) |
| `REDIS_HOST` | | Redis hostname (default: `localhost`) |
| `REDIS_PORT` | | Redis port (default: `6380`) |
| `SMTP_HOST` | | Omit to use Ethereal test emails |
| `SMTP_USER` | | SMTP username |
| `SMTP_PASS` | | SMTP password |
| `SMTP_FROM` | | From address |
| `APP_URL` | | Base URL for tenant login links in emails |
| `SUPER_ADMIN_EMAIL` | | Seed email (default: `admin@lendershub.com`) |
| `SUPER_ADMIN_PASSWORD` | | Seed password (default: `Admin@LH2024!`) |

### Frontend (`frontend/.env.local` for local dev)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✓ | Backend API URL (e.g. `http://localhost:4001`) |

> **Note:** `NEXT_PUBLIC_*` variables are baked into the JavaScript bundle at build time by Next.js. In Docker, they must be passed as build arguments (already configured in `docker-compose.yml`), not just runtime environment variables.

---

## First-Time Checklist

- [ ] Log in at `/super-admin/login`
- [ ] Change the default password via **Settings → Change Password**
- [ ] Enable 2FA (TOTP) — scan QR code with Google Authenticator / Authy
- [ ] Create your first tenant: **Tenants → New Tenant**

---

## Development Scripts

### Backend (`cd backend`)

```bash
npm run start:dev           # Hot-reload dev server
npm run build               # Compile TypeScript → dist/
npm run start:prod          # Run compiled output (node dist/main)
npm run seed                # Create super-admin user
npm run lint                # ESLint

# Prisma
npx prisma migrate dev --name <name>   # Create new migration
npx prisma migrate deploy              # Apply pending migrations
npx prisma generate                    # Regenerate client after schema changes
npx prisma studio                      # Database browser GUI
```

### Frontend (`cd frontend`)

```bash
npm run dev     # Hot-reload dev server (port 3000)
npm run build   # Production build
npm start       # Run production build
npm run lint    # ESLint
```

---

## Project Structure

```
LendersHub/
├── .env                            # Root env — Docker Compose reads this
├── docker-compose.yml              # All 4 services: db, redis, backend, frontend
├── docker/
│   ├── Dockerfile.backend          # Multi-stage: build (tsc) + production
│   └── Dockerfile.frontend         # Multi-stage: build (next build) + standalone
├── backend/
│   ├── .dockerignore
│   ├── prisma.config.ts            # Prisma 7 config — database URL for migrations
│   ├── prisma/
│   │   ├── schema.prisma           # Data models (Tenant, User, Loan, LoginAuditLog)
│   │   ├── migrations/             # SQL migration history (6 migrations)
│   │   └── seed.ts                 # Super-admin seed script
│   └── src/
│       ├── main.ts                 # Bootstrap — compiles to dist/main.js
│       ├── app.module.ts
│       ├── prisma/
│       │   ├── prisma.service.ts   # PrismaClient with PrismaPg adapter + RLS extension
│       │   └── prisma.module.ts
│       ├── rls/rls-context.ts      # AsyncLocalStorage for per-request RLS context
│       ├── middleware/             # TenantRlsMiddleware
│       ├── auth/                   # JWT + Passport strategies
│       ├── cache/                  # Redis cache module
│       ├── super-admin/            # Super-admin APIs (tenants, users, dashboard)
│       └── tenant/                 # Tenant-scoped APIs (customers, loans, payments)
└── frontend/
    ├── .dockerignore
    ├── next.config.ts              # output: "standalone" for Docker
    └── src/
        ├── middleware.ts           # Subdomain → /tenant/[subdomain] rewrite
        ├── services/tenant-api.ts  # Tenant API client (browser-safe localStorage)
        └── app/
            ├── super-admin/        # Super-admin panel pages
            ├── tenant/
            │   ├── login/          # Tenant login (org + email + password)
            │   └── [subdomain]/    # Per-tenant dashboard, customers, loans, …
            └── [subdomain]/        # Subdomain-based routing (rewrites to /tenant/*)
```

---

## Troubleshooting

### Port already in use

```bash
# Windows
netstat -ano | findstr :4001
taskkill /PID <pid> /F

# macOS / Linux
lsof -ti:4001 | xargs kill -9
```

### Backend crash-loops on startup

Check logs first:
```bash
docker compose logs backend
```

Common causes:
- `DATABASE_URL` not set — ensure `.env` has `JWT_SECRET` and `POSTGRES_*` values
- Migrations failed — check Postgres is healthy: `docker compose ps`
- Wrong entry point — compiled output is at `dist/main.js` (not `dist/src/main.js`)

### `NEXT_PUBLIC_API_URL` not working in Docker

This variable is baked into the JS bundle at build time. Changing it in `.env` after the image is built has no effect. Rebuild the frontend image:
```bash
docker compose up --build frontend
```

### Prisma client out of date

Run whenever `prisma/schema.prisma` changes:
```bash
cd backend && npx prisma generate
```

In Docker: `docker compose up --build backend`

### Database connection refused

```bash
docker compose up db redis -d
docker compose ps
```

### Seed fails

Migrations must be applied before seeding:
```bash
cd backend
npx prisma migrate deploy
npm run seed
```

### Welcome emails not arriving

Without SMTP configured, emails go to [Ethereal](https://ethereal.email) (a test inbox). The preview URL is printed in the backend terminal:
```
[TenantService] Welcome email preview: https://ethereal.email/message/...
```
