# Handoff: Role model + loan approval workflow (feat/daily-loan-missed-payment-ui)

## Status
Code complete, `tsc --noEmit` clean on backend + frontend, existing `per-1000-schedule.spec.ts` (15 tests) passes.
**Not yet run against a real database. Not deployed. Not click-tested in a browser.**
Plan file (full detail): `C:\Users\cdhan\.claude\plans\polymorphic-moseying-curry.md`

## What changed
- New tenant role set: `OWNER, ADMIN, MANAGER, AGENT, STAFF, CUSTOMER` (was `OWNER, MANAGER, ADMIN, LOAN_OFFICER, COLLECTOR, VIEWER`). Shared constants: `backend/src/tenant/common/roles.ts`, mirrored in `frontend/src/services/tenant-api.ts`.
- Permission matrix (Add User / Add Customer / View Loan / Add Loan / Update Loan / View Collection / Add Collection) enforced per role — see plan file for the full table.
- Loan approval workflow: loans created by Agent/Staff land `PENDING`; new `PATCH :id/approve`, `:id/reject`, `:id/approve-close` endpoints (Owner/Admin/Manager only). Close requests from Agent/Staff set a new `pending_closure` column instead of closing directly.
- Loan Agent assignment (`loan_officer_id`) now pickable on all 5 loan-creation forms, Owner/Admin/Manager only.
- "+" add-installment tile on loan detail pages, Owner/Admin/Manager only.
- Ledger restricted to Admin/Owner (backend + nav).
- Approve/Reject/Approve-Closure buttons + "Closure pending approval" badge on all 5 loan detail pages.

## Before deploying — do these in order

1. **Check for active `VIEWER`/`LOAN_OFFICER`/`COLLECTOR` users in every tenant DB** before running the migration:
   ```sql
   SELECT id, email, role FROM users WHERE role IN ('VIEWER','LOAN_OFFICER','COLLECTOR');
   ```
   Migration silently reassigns `LOAN_OFFICER`/`COLLECTOR`→`AGENT`, `VIEWER`→`STAFF`. Anyone with an active session holds a JWT with the OLD role string until they re-log in — old-role JWTs will fail the new `MANAGER_ROLES`/`FIELD_ROLES` checks. **Force a re-login (or short JWT expiry) right after migrating**, or users get spurious 403s.

2. **Run the migration against a staging/cloned tenant schema first**, not prod directly. The DDL is in `backend/src/super-admin/tenants/tenant-schema.ts` (`tenantSchemaDDL`) — it runs automatically wherever that function is invoked per-tenant (see `backend/src/super-admin/tenants/tenant.service.ts`). Confirm:
   - The 3 new `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements succeed.
   - The `UPDATE users SET role='AGENT'/'STAFF' WHERE ...` statements (near the end of the DDL array, intentionally placed after the ADD VALUE statements to avoid same-transaction enum-visibility issues) actually update the right rows.
   - `pending_closure` column gets added to `loans` (via the idempotent `ALTER TABLE` pattern in `tenant-loans.service.ts`, not the schema DDL file — check `ensureInterestRatePrecision` or nearby helper).

3. **Click-test end-to-end** on a seeded tenant (one user per role — Owner, Admin, Manager, Agent, Staff, Customer if it has a login):
   - Nav gating matches the matrix (Team/Ledger/Loan Types visibility per role).
   - Agent creates a loan → lands PENDING → invisible/unusable until Manager approves via the new Approve button.
   - Agent's loan list shows only their own loans (`View Loan = Self`); Staff sees all.
   - Agent requests close → "Closure pending approval" badge appears for both the Agent and the Manager → Manager clicks Approve Closure → loan becomes CLOSED.
   - "+" installment tile only visible to Owner/Admin/Manager.
   - Ledger nav/endpoint 403s for Manager/Agent/Staff, works for Admin/Owner.
   - Reject flow: `window.prompt()` for reason works (known rough edge — browser-popup-blocker dependent, flagged as a stopgap, not final UX).

4. **No automated tests exist yet** for approve/reject/approve-close, the Self/All view scoping, or add-installment. Worth writing before/after prod rollout, not necessarily blocking it, but a known gap.

5. Mobile app (`mobile/src/screens/profile/ProfileScreen.tsx`) role-badge colors and `tenant-collections.service.ts`'s stale `LOAN_OFFICER` comment were fixed this session — no further mobile work needed for this feature, but the mobile app hasn't been rebuilt/tested against the new role strings either.

## Known deliberate simplifications (not bugs, just scope calls made along the way)
- Reject reason stored in the existing `close_comment` column rather than a new dedicated column.
- Add-installment restricted to Owner/Admin/Manager (not Agent/Staff) — treated as an "edit" under the `Update Loan = No` rule for Agent/Staff, per the matrix.
- `CUSTOMER` role has no login/auth flow — added to the enum for future use only, per explicit decision earlier in this session.

## Nothing is committed
All changes are in the working tree on branch `feat/daily-loan-missed-payment-ui`, uncommitted. Review with `git diff` / `git status` before committing.
