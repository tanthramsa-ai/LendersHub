# LendersHub

A multi-tenant SaaS platform for lending companies. Each tenant (lender) gets an isolated PostgreSQL schema, their own user base, a branded web portal, and a field-agent mobile app.

## What's in the box

| Module | What it does |
|---|---|
| **Multi-tenant auth** | JWT login with 2-step SMS OTP for users who have a phone; forgot / reset password via OTP |
| **Loan types** | Weekly, daily (with/without Sunday), monthly interest-only, agent-risk, and standard term loans — each with EMI preview before creation |
| **Collections** | Agent-facing installment list (today / overdue), payment capture with receipt photo, offline queue that syncs when online |
| **Customers** | Full KYC profile — PAN / Aadhaar, alt contact, locality, occupation; branch assignment |
| **Branch management** | Create branches, assign team members per branch, view member / customer / loan counts |
| **Role-based access** | Six roles: Owner → Manager → Admin → Loan Officer → Collector → Viewer — enforced at API level |
| **Notifications** | In-app notifications pushed to managers on loan creation / closure |
| **Ledger** | Fund transactions ledger (credits, debits, principal) |
| **SMS / WhatsApp** | Pluggable providers (Fast2SMS, Msg91 for SMS; Twilio / Meta / WATI for WhatsApp); falls back to console in dev |
| **Mobile app** | Expo / React Native app for field agents — offline-capable, biometric unlock, route map, payment capture |
| **Super-admin** | Tenant lifecycle management, subscription tiers, platform-level dashboard |

## Architecture

```
frontend/   Next.js 16 (App Router, standalone output) — super-admin + tenant web UI
backend/    NestJS 11 + PostgreSQL (per-tenant schema isolation via SET search_path)
mobile/     Expo SDK 55 / React Native — field-agent app
docker/     Dockerfiles for backend and frontend
```

**Key design decisions**

| Concern | Approach |
|---|---|
| Tenant isolation | Per-tenant PostgreSQL schema (`SET search_path = "tenant_<slug>", public`) — no RLS cross-contamination |
| Super-admin bypass | Requests to `/api/v1/super-admin/*` operate on the `public` schema directly |
| Auth — web | JWT (NestJS Passport), 8 h expiry. Users with a phone number require OTP verification on login |
| Auth — mobile | Phone + password → OTP → JWT stored in Expo SecureStore; biometric unlock on subsequent opens |
| OTP | 6-digit, 10-minute TTL, single-use, stored in per-tenant `otp_tokens` table; previous OTPs invalidated on re-login |
| Frontend Docker | `output: "standalone"` — self-contained image, no separate `node_modules` copy |

---

## Role Matrix

| Action | Owner | Manager | Admin | Loan Officer | Collector | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View dashboard | ✓ | ✓ | ✓ | ✓ (own) | ✓ (assigned) | ✓ |
| Create / close loans | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Close loans | ✓ | ✓ | ✓ | — | — | — |
| Create customers | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Record payments | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Manage users | ✓ | — | ✓ | — | — | — |
| Manage branches / settings | ✓ | — | ✓ | — | — | — |

---

## Prerequisites

| Tool | Version |
|---|---|
| Docker Desktop | latest |
| Node.js | 22.x (local dev only) |
| npm | 10.x (local dev only) |

---

## Option A — Full Docker (recommended)

Run the entire stack — PostgreSQL, Redis, backend, frontend — with one command.

### 1. Clone

```bash
git clone https://github.com/dhanapalan/LendersHub.git
cd LendersHub
```

### 2. Configure `.env`

The root `.env` is committed with safe development defaults. For production, change at minimum:

```env
POSTGRES_PASSWORD=<strong-password>
JWT_SECRET=<64-char-random-string>
```

Current defaults (local dev only):

```env
POSTGRES_DB=lendershub
POSTGRES_USER=postgres
POSTGRES_PASSWORD=devpass
JWT_SECRET=lendershub-super-secret-jwt-key-change-in-production-32chars
NEXT_PUBLIC_API_URL=http://localhost:4001
```

### 3. Build and start

```bash
docker compose up --build
```

First build takes ~5 minutes (Next.js compile is the longest step).

| Service | Host port | URL |
|---|---|---|
| Frontend (Next.js) | 3000 | http://localhost:3000 |
| Backend (NestJS) | 4001 | http://localhost:4001 |
| PostgreSQL | 5433 | `postgresql://localhost:5433/lendershub` |
| Redis | 6380 | `redis://localhost:6380` |

### 4. Seed the super-admin (first run only)

```bash
docker compose exec backend sh -c "node -e \"require('./dist/prisma/seed');\""
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
docker compose up --build backend      # rebuild backend only
docker compose up --build frontend     # rebuild frontend only
```

---

## Option B — Local Development (hot-reload)

### 1. Start infrastructure only

```bash
docker compose up db redis -d
```

### 2. Backend

```bash
cd backend
npm install
npx prisma migrate deploy
npm run seed
npm run start:dev          # http://localhost:4001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                # http://localhost:3000
```

### 4. Mobile app

```bash
cd mobile
npm install
npx expo start             # scan QR with Expo Go, or press a/i for emulator
```

Set `EXPO_PUBLIC_API_URL` in `mobile/.env` to your local network IP:

```env
EXPO_PUBLIC_API_URL=http://192.168.x.x:4001
```

---

## Tenant Portal

| Path | Description |
|---|---|
| `/super-admin/login` | Super-admin login |
| `/tenant/<subdomain>/login` | Tenant login (path-based) |
| `/<subdomain>/login` | Tenant login (subdomain-based, rewritten by middleware) |
| `/<subdomain>/dashboard` | Tenant dashboard |
| `/<subdomain>/loans` | All loans list |
| `/<subdomain>/weekly-loans` | Weekly loan list + new |
| `/<subdomain>/daily-loans` | Daily loan list + new |
| `/<subdomain>/monthly-loans` | Monthly interest-only loan list + new |
| `/<subdomain>/agent-risk-loans` | Agent-risk loan list + new |
| `/<subdomain>/customers` | Customer list + new |
| `/<subdomain]/users` | Team members + branch assignment |
| `/<subdomain>/settings` | Branches, loan types, SMS, WhatsApp |
| `/<subdomain>/notifications` | In-app notification inbox |
| `/<subdomain>/ledger` | Fund transaction ledger |

To create a tenant: log in as super-admin → **Tenants → New Tenant**.

---

## Environment Variable Reference

### Root `.env` (Docker Compose)

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_DB` | ✓ | Database name |
| `POSTGRES_USER` | ✓ | Database user |
| `POSTGRES_PASSWORD` | ✓ | Database password |
| `JWT_SECRET` | ✓ | Secret for signing JWTs — use a long random string in production |
| `NEXT_PUBLIC_API_URL` | ✓ | URL the browser uses to reach the backend (baked in at build time) |

### Backend (`backend/.env` for local dev)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | Full PostgreSQL connection string |
| `JWT_SECRET` | ✓ | Must match the root `.env` value |
| `PORT` | | HTTP port (default: `4001`) |
| `REDIS_HOST` | | Redis hostname (default: `localhost`) |
| `REDIS_PORT` | | Redis port (default: `6380`) |
| `SUPER_ADMIN_EMAIL` | | Seed email (default: `admin@lendershub.com`) |
| `SUPER_ADMIN_PASSWORD` | | Seed password (default: `Admin@LH2024!`) |

> SMS and WhatsApp credentials are configured per-tenant via **Settings → SMS / OTP** and **Settings → WhatsApp** in the tenant portal — not in `.env`.

### Frontend (`frontend/.env.local` for local dev)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✓ | Backend API URL (e.g. `http://localhost:4001`) |

> `NEXT_PUBLIC_*` variables are baked into the JS bundle at build time. Changing them after the image is built has no effect — rebuild the frontend image.

### Mobile (`mobile/.env`)

| Variable | Required | Description |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | ✓ | Backend API URL on your local network (e.g. `http://192.168.x.x:4001`) |

---

## First-Time Checklist

- [ ] Log in at `/super-admin/login`
- [ ] Change the default password via **Settings → Change Password**
- [ ] Enable 2FA (TOTP) — scan QR with Google Authenticator / Authy
- [ ] Create your first tenant: **Tenants → New Tenant**
- [ ] Log in to the tenant portal and configure **Settings → Branches**
- [ ] Add team members and assign them to branches under **Settings → Branches → 👥 Team**
- [ ] Configure SMS provider under **Settings → SMS / OTP** (use Console for dev, Fast2SMS for production)

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

### Mobile (`cd mobile`)

```bash
npx expo start              # Start dev server (Expo Go or emulator)
npx expo start --android    # Android emulator
npx expo start --ios        # iOS simulator (macOS only)
npx expo build              # EAS build (requires eas-cli)
```

---

## Project Structure

```
LendersHub/
├── .env                            # Root env — Docker Compose reads this
├── docker-compose.yml              # 4 services: db, redis, backend, frontend
├── docker/
│   ├── Dockerfile.backend          # Multi-stage: build (tsc) + production
│   └── Dockerfile.frontend         # Multi-stage: build (next build) + standalone
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma           # Tenant, User, LoginAuditLog (public schema)
│   │   ├── migrations/             # SQL migration history
│   │   └── seed.ts                 # Super-admin seed script
│   └── src/
│       ├── main.ts                 # Bootstrap + global validation pipe
│       ├── app.module.ts           # Root module
│       ├── prisma/                 # PrismaService with pg pool
│       ├── auth/                   # Super-admin JWT + TOTP 2FA
│       ├── cache/                  # Redis cache module
│       ├── sms/                    # Pluggable SMS service (Fast2SMS, Msg91, Console)
│       ├── whatsapp/               # Pluggable WhatsApp service
│       ├── scheduler/              # Cron jobs (overdue reminders, etc.)
│       ├── super-admin/            # Tenant management, platform dashboard
│       │   └── tenants/
│       │       └── tenant-schema.ts  # DDL run on tenant creation/migration
│       └── tenant/                 # Per-tenant APIs (all schema-scoped)
│           ├── auth/               # Login (OTP flow), verify-otp, forgot/reset password
│           ├── branches/           # Branch CRUD + GET :id/members
│           ├── collections/        # Today / overdue installments, record payment
│           ├── customers/          # Customer CRUD with extended KYC fields
│           ├── dashboard/          # Stats, recent activity, active loans (role-aware)
│           ├── loans/              # All loan types + close endpoint
│           ├── notifications/      # In-app notification inbox
│           ├── loan-types/         # Loan product catalogue
│           ├── accounts/           # Fund account management
│           ├── ledger/             # Fund transaction ledger
│           ├── settings/           # SMS / WhatsApp config (per-tenant, encrypted)
│           └── users/              # Team member CRUD, officers list, user loans
│
├── frontend/
│   ├── next.config.ts              # output: "standalone" for Docker
│   └── src/
│       ├── middleware.ts           # Subdomain → /tenant/[subdomain] rewrite
│       ├── services/tenant-api.ts  # Typed API client (browser, localStorage token)
│       └── app/
│           ├── super-admin/        # Super-admin panel
│           ├── tenant/[subdomain]/ # Per-tenant portal pages
│           └── [subdomain]/        # Subdomain routing (rewrites to /tenant/*)
│
└── mobile/
    └── src/
        ├── api/                    # collections, customers, auth fetch wrappers
        ├── db/                     # SQLite offline cache (expo-sqlite)
        ├── navigation/             # React Navigation stacks and tabs
        ├── screens/
        │   ├── auth/               # Login, BiometricSetup
        │   ├── collections/        # CollectionsList, CollectionDetail, RouteMap
        │   ├── customers/          # CustomersList, CustomerDetail
        │   ├── home/               # HomeScreen (stats + quick actions)
        │   └── payments/           # PaymentCapture, ReceiptCamera
        └── store/                  # Zustand stores (auth, collections)
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

```bash
docker compose logs backend
```

Common causes:
- Missing `.env` — ensure `JWT_SECRET` and `POSTGRES_*` are set
- Migrations failed — check Postgres health: `docker compose ps`
- Wrong entry point — compiled output is `dist/main.js` (not `dist/src/main.js`)

### `NEXT_PUBLIC_API_URL` not working in Docker

Baked in at build time. Rebuild after changing:

```bash
docker compose up --build frontend
```

### OTP not arriving on mobile

In development the default SMS provider is **Console** — OTPs are printed to the backend log, not sent via SMS. Set the provider to **Fast2SMS** (or another) in **Settings → SMS / OTP** and provide a valid API key.

### Mobile app cannot reach backend

Ensure `EXPO_PUBLIC_API_URL` in `mobile/.env` points to your machine's LAN IP (not `localhost`). Android emulator uses `10.0.2.2` for the host machine.

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
