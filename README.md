# LendersHub

A multi-tenant SaaS platform for lending companies. Each tenant (lender) gets an isolated PostgreSQL schema, their own user base, and a branded portal. A super-admin panel manages tenants, subscriptions, and platform health.

## Architecture

```
frontend/   Next.js 16 (App Router) — super-admin UI
backend/    NestJS 11 + Prisma 7 + PostgreSQL (Row-Level Security)
database/   PostgreSQL 15 (Docker)
mobile/     Expo (React Native) — future
```

**Key design decisions**

| Concern | Approach |
|---|---|
| Tenant isolation | Each tenant gets its own PostgreSQL schema (`tenant_<subdomain>`) |
| Platform-level data | Single `public` schema — `tenants`, `users`, `loans` with **FORCE ROW LEVEL SECURITY** |
| Super-admin bypass | Requests to `/api/v1/super-admin/*` set `app.bypass_rls = 'true'` via a dedicated pg connection |
| Auth | JWT (NestJS Passport) + optional TOTP 2FA for super admins |

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x | `node --version` |
| npm | 10.x | bundled with Node 22 |
| Docker Desktop | latest | for PostgreSQL + Redis |
| Git | any | |

---

## Option A — Local Development (recommended for testing)

Use this when you want hot-reload and easy debugging.

### 1. Clone and install

```bash
git clone https://github.com/dhanapalan/LendersHub.git
cd LendersHub
```

### 2. Start infrastructure (database + Redis only)

```bash
docker compose up db redis -d
```

This starts:
- PostgreSQL on **localhost:5433**
- Redis on **localhost:6380**

### 3. Configure the backend

```bash
cd backend
```

Create `backend/.env` with:

```env
DATABASE_URL="postgresql://postgres:devpass@localhost:5433/lendershub?schema=public"
JWT_SECRET="any-long-random-string-change-in-production"
REDIS_HOST=localhost
REDIS_PORT=6380
PORT=4001
```

> Make sure `POSTGRES_PASSWORD` in `docker/.env.example` matches what you put in `DATABASE_URL`. For a fresh setup, you can use `devpass` as shown above — just set it consistently everywhere.

### 4. Start Docker with that password

Edit `docker/.env.example`, set `POSTGRES_PASSWORD=devpass`, then:

```bash
# from project root
docker compose up db redis -d
```

Or create `LendersHub/.env`:
```env
POSTGRES_DB=lendershub
POSTGRES_USER=postgres
POSTGRES_PASSWORD=devpass
```

### 5. Run database migrations

```bash
cd backend
npx prisma migrate deploy
```

### 6. Seed the super-admin user

```bash
npm run seed
```

Output:
```
✓ Super admin created successfully
  Email    : admin@lendershub.com
  Password : Admin@LH2024!
  ⚠  Change this password immediately after first login!
```

Custom credentials:
```bash
SUPER_ADMIN_EMAIL=you@company.com SUPER_ADMIN_PASSWORD=MyP@ss123 npm run seed
```

### 7. Start the backend

```bash
npm run start:dev
```

Look for: `Backend v3 (direct-query) running on http://localhost:4001`

### 8. Configure and start the frontend

Open a **new terminal**:

```bash
cd LendersHub/frontend
```

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:4001
```

```bash
npm install
npm run dev
```

Frontend runs on **http://localhost:3000**.

### 9. Log in

Open **http://localhost:3000/super-admin/login** with the credentials from step 6.

---

## Option B — Full Docker

Run everything with one command — no local Node/Postgres/Redis required.

### 1. Clone

```bash
git clone https://github.com/dhanapalan/LendersHub.git
cd LendersHub
```

### 2. Create the root `.env`

```bash
cp docker/.env.example .env
```

Edit `.env` — change at minimum:
- `POSTGRES_PASSWORD` — strong password (no special chars that break URLs)
- `JWT_SECRET` — random 64-character string
- `DATABASE_URL` — update the password to match `POSTGRES_PASSWORD`

### 3. Build and start

```bash
docker compose up --build -d
```

First build takes 3–5 minutes. Services:

| Service | Port | URL |
|---|---|---|
| PostgreSQL | 5433 | `postgresql://localhost:5433/lendershub` |
| Redis | 6380 | `redis://localhost:6380` |
| Backend | 4001 | http://localhost:4001 |
| Frontend | 3000 | http://localhost:3000 |

The backend automatically runs pending migrations on startup.

### 4. Seed the super-admin

```bash
docker compose exec backend npm run seed
```

Custom credentials:
```bash
docker compose exec \
  -e SUPER_ADMIN_EMAIL=you@company.com \
  -e SUPER_ADMIN_PASSWORD=Str0ng!Pass \
  backend npm run seed
```

### 5. Log in

Open **http://localhost:3000/super-admin/login**.

### Useful Docker commands

```bash
docker compose logs -f backend      # live backend logs
docker compose logs -f frontend     # live frontend logs
docker compose down                 # stop (data preserved)
docker compose down -v              # stop + wipe all data
docker compose up --build -d        # rebuild after code changes
```

---

## Environment Variable Reference

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `JWT_SECRET` | ✓ | Secret for signing JWTs — long random string |
| `PORT` | | HTTP port (default: `4001`) |
| `REDIS_HOST` | | Redis hostname (default: `localhost`) |
| `REDIS_PORT` | | Redis port (default: `6380`) |
| `SMTP_HOST` | | SMTP server — omit to use Ethereal test emails |
| `SMTP_PORT` | | SMTP port (default: `587`) |
| `SMTP_SECURE` | | Use TLS: `true` or `false` |
| `SMTP_USER` | | SMTP username |
| `SMTP_PASS` | | SMTP password |
| `SMTP_FROM` | | From address e.g. `LendersHub <no-reply@co.com>` |
| `APP_URL` | | Base URL for tenant login links in welcome emails |
| `SUPER_ADMIN_EMAIL` | | Used by `npm run seed` (default: `admin@lendershub.com`) |
| `SUPER_ADMIN_PASSWORD` | | Used by `npm run seed` (default: `Admin@LH2024!`) |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✓ | URL the browser uses to reach the backend API |

---

## First-Time Checklist

After setup, complete these steps:

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
npm run start:prod          # Run compiled output
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
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Data models (Tenant, User, Loan, …)
│   │   ├── migrations/            # SQL migration history
│   │   └── seed.ts                # Super-admin seed script
│   └── src/
│       ├── main.ts                # Bootstrap + global exception filter
│       ├── prisma/prisma.service.ts  # PrismaService with RLS context extension
│       ├── rls/rls-context.ts     # AsyncLocalStorage for per-request RLS context
│       ├── middleware/            # TenantRlsMiddleware — sets bypass or tenant scope
│       └── super-admin/
│           ├── super-admin-auth.* # Login, 2FA setup/verify, password change
│           ├── tenants/           # Tenant CRUD + schema provisioning
│           ├── dashboard/         # KPIs, MRR, active users, alerts
│           └── users/             # Super-admin user list + audit log
├── frontend/
│   └── src/app/super-admin/
│       ├── dashboard/             # Main dashboard + detail pages
│       ├── tenants/               # Tenant list, detail, new-tenant wizard
│       ├── billing/
│       ├── subscriptions/
│       ├── users/
│       ├── system-health/
│       └── settings/
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   ├── nginx.conf                 # Reverse-proxy config (optional)
│   └── .env.example              # Template — copy to ../.env
├── docker-compose.yml
└── README.md
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

### Prisma client out of date (`Unknown argument` errors)

Run this whenever `prisma/schema.prisma` changes:
```bash
cd backend && npx prisma generate
```

### Database connection refused

Make sure the Docker containers are running:
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

Without SMTP configured, emails go to [Ethereal](https://ethereal.email) (a test inbox). The preview URL is printed in the backend terminal after each tenant creation:
```
[TenantService] Welcome email preview: https://ethereal.email/message/...
```
