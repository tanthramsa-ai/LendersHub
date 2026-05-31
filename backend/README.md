# LendersHub — Backend

NestJS 11 API server for the LendersHub multi-tenant lending platform.

See the [root README](../README.md) for full setup instructions, architecture overview, and environment variable reference.

## Quick start (local dev)

```bash
# from repo root — start Postgres + Redis
docker compose up db redis -d

# install deps and start with hot-reload
npm install
npm run start:dev   # http://localhost:4001
```

## Key modules

| Module | Path | Description |
|---|---|---|
| Auth (tenant) | `src/tenant/auth/` | JWT login with 2-step OTP, forgot/reset password |
| Branches | `src/tenant/branches/` | Branch CRUD + team member assignment |
| Collections | `src/tenant/collections/` | Installment lists, record payment, role scoping |
| Customers | `src/tenant/customers/` | Full KYC CRUD |
| Dashboard | `src/tenant/dashboard/` | Role-aware stats, recent activity, active loans |
| Loans | `src/tenant/loans/` | Weekly / daily / monthly / agent-risk / term loans |
| Notifications | `src/tenant/notifications/` | In-app notification inbox |
| Loan Types | `src/tenant/loan-types/` | Loan product catalogue |
| Ledger | `src/tenant/ledger/` | Fund transaction ledger |
| Settings | `src/tenant/settings/` | Per-tenant SMS / WhatsApp config |
| Users | `src/tenant/users/` | Team member CRUD, role management |
| SMS | `src/sms/` | Pluggable SMS (Fast2SMS, Msg91, Console) |
| WhatsApp | `src/whatsapp/` | Pluggable WhatsApp (Twilio, Meta, WATI, Console) |
| Scheduler | `src/scheduler/` | Cron jobs for overdue reminders |
| Super-admin | `src/super-admin/` | Tenant lifecycle, platform dashboard |

## Scripts

```bash
npm run start:dev           # Hot-reload
npm run build               # Compile TypeScript → dist/
npm run start:prod          # Run dist/main.js
npm run seed                # Seed super-admin user
npm run lint                # ESLint

npx prisma migrate dev --name <name>   # New migration
npx prisma migrate deploy              # Apply migrations
npx prisma generate                    # Regenerate client
npx prisma studio                      # DB browser GUI
```
