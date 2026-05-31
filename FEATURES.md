# LendersHub — Feature Documentation

**Version:** 1.0  
**Last Updated:** May 2026  
**Stack:** NestJS · PostgreSQL (per-tenant schema isolation) · Next.js 14 · Tailwind CSS

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication](#2-authentication)
3. [Role-Based Access Control](#3-role-based-access-control)
4. [Customer Management](#4-customer-management)
5. [Loan Management — Monthly Loans](#5-loan-management--monthly-loans)
6. [Loan Management — Weekly Loans](#6-loan-management--weekly-loans)
7. [Payment Recording & Collection](#7-payment-recording--collection)
8. [Loan Types](#8-loan-types)
9. [Branch Management](#9-branch-management)
10. [User Management](#10-user-management)
11. [Notifications](#11-notifications)
12. [Settings](#12-settings)
13. [Database Schema](#13-database-schema)
14. [API Reference](#14-api-reference)
15. [Frontend Page Map](#15-frontend-page-map)

---

## 1. Architecture Overview

LendersHub is a **multi-tenant SaaS lending management platform**. Each tenant (lending company) gets an isolated PostgreSQL schema (`tenant_{subdomain}`) with no data cross-contamination.

```
Browser → subdomain.lendershub.in
             │
             ▼
        Next.js Middleware
        (rewrites to /tenant/[subdomain])
             │
             ▼
        NestJS Backend
        (JWT-scoped to tenant)
             │
             ▼
        PostgreSQL
        tenant_{subdomain} schema
```

### Key Design Decisions

| Concern | Approach |
|---------|----------|
| Multi-tenancy | Per-tenant PostgreSQL schema; `SET search_path` per request |
| Auth | JWT; payload carries `sub` (userId), `role`, `schemaName`, `subdomain` |
| Routing | Next.js middleware rewrites `{sub}.domain/path` → `/tenant/{sub}/path` |
| Role scope | All queries respect `user.role` and `user.sub` from JWT |
| File uploads | Base64 data URL stored in TEXT columns (max 10 MB) |
| Soft delete | `deleted_at IS NULL` filter on loans, customers, loan_types |

---

## 2. Authentication

### Login Methods

Tenants access the system via their company subdomain (e.g., `acme.lendershub.in`). Two login paths are supported:

| Method | Fields |
|--------|--------|
| Phone + Password | `phone`, `password`, `subdomain` |
| Email + Password | `email`, `password`, `subdomain` |

### OTP / 2FA

If a user has a phone number and 2FA is triggered, the login flow returns a `tempToken` and `maskedPhone`. The user completes login by submitting the OTP sent to their phone.

```
POST /api/v1/tenant/auth/login
  → { accessToken, expiresIn, user, tenant }
  OR { requiresOtp: true, tempToken, maskedPhone }

POST /api/v1/tenant/auth/verify-otp
  { tempToken, otp }
  → { accessToken, ... }
```

### JWT Payload

```json
{
  "sub": "<userId>",
  "role": "LOAN_OFFICER",
  "schemaName": "tenant_acme",
  "subdomain": "acme",
  "email": "officer@acme.com"
}
```

All subsequent API calls must include `Authorization: Bearer <token>`.

---

## 3. Role-Based Access Control

### Role Hierarchy

```
OWNER
  └── MANAGER
        └── ADMIN
              └── LOAN_OFFICER
                    └── COLLECTOR
                          └── VIEWER
```

### Role Definitions

| Role | Description |
|------|-------------|
| **OWNER** | Company founder; full access including settings and all data |
| **MANAGER** | Operations supervisor; can approve/close loans, see all data |
| **ADMIN** | System administrator; can manage users and branches |
| **LOAN_OFFICER** | Field agent; can create loans/customers but sees only their own portfolio |
| **COLLECTOR** | Collection agent; can record payments and create loans |
| **VIEWER** | Read-only access to all data |

### Permission Matrix

| Action | OWNER | MANAGER | ADMIN | LOAN_OFFICER | COLLECTOR | VIEWER |
|--------|:-----:|:-------:|:-----:|:------------:|:---------:|:------:|
| Create Loan | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Approve / Close Loan | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Record Payment | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Create Customer | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Edit Customer | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Create User | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Deactivate User | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Reset User Password | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Manage Branches | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Manage Loan Types | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| View All Loans | ✓ | ✓ | ✓ | own only | own only | ✓ |
| View All Customers | ✓ | ✓ | ✓ | own only | ✓ | ✓ |
| Org Settings | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |

### Data Visibility Rules

**LOAN_OFFICER** self-filter is enforced at the database query level:
- **Loans**: only loans where `loan_officer_id = userId`
- **Customers**: only customers who have at least one loan assigned to this officer
- **Weekly Loans**: same filter on `loan_officer_id`

---

## 4. Customer Management

### Overview

Customers are the borrowers in the system. A customer must be created before any loan can be issued to them.

### Required Fields (at creation)

| Field | Validation |
|-------|------------|
| `firstName` | Required |
| `phone` | Required; unique per tenant; 10 digits |
| `address` | Required (street address) |
| `locality` | Required (area / neighbourhood) |
| `altContact` | Required (alternate contact number) |
| KYC | At least one of `panNumber` or `aadhaarLast4` is mandatory |

### Optional Fields

| Field | Notes |
|-------|-------|
| `lastName` | |
| `email` | |
| `dateOfBirth` | |
| `city`, `state`, `pincode` | |
| `occupation` | |
| `loanPurpose` | Default purpose for loans |
| `creditScore` | Numeric |
| `altContactName` | Name of alternate contact person |
| `altContactRelation` | e.g., Spouse, Parent, Friend |
| `aadhaarDocUrl` | Base64-encoded document upload (max 10 MB) |
| `branchId` | Assign to a branch |

### Customer Code

Auto-generated on creation: `CUST000001`, `CUST000002`, etc.

### Business Rules

- Phone must be unique within the tenant schema.
- PAN format validation (if provided): `ABCDE1234F` pattern.
- Aadhaar: only last 4 digits stored (for privacy).
- Soft delete: `deleted_at` column; deleted customers are hidden from lists.
- LOAN_OFFICER sees only their own customers (those who have a loan assigned to that officer).

### Customer Detail View

When viewing a customer, the following aggregates are displayed:
- Total number of loans
- Number of active loans
- Total principal repaid (across all payments)
- Branch assignment and branch code
- Full KYC details including Aadhaar document link

---

## 5. Loan Management — Monthly Loans

### Overview

Standard monthly EMI loans using reducing balance amortization.

### Loan Number Format

`LN{YYYY}{000001}` — e.g., `LN2026000042`

### Constraints

| Field | Rule |
|-------|------|
| Principal | Must be > 0 |
| Interest Rate | 0–100% per annum |
| Term | 1–360 months |
| Status at creation | `PENDING` |

### EMI Calculation

Standard reducing balance (amortization) formula:

```
EMI = P × r × (1+r)^n / ((1+r)^n - 1)

where:
  P = principal
  r = monthly rate = annual_rate / 12 / 100
  n = term in months
```

Each installment row stores `principal_amount`, `interest_amount`, `total_amount`.

### Loan Lifecycle

```
PENDING → APPROVED → DISBURSED → CLOSED
                               ↘ DEFAULTED
```

Closing a loan marks all remaining PENDING/PARTIALLY_PAID/OVERDUE installments as `WAIVED`.

### Installment Status Lifecycle

```
PENDING → PARTIALLY_PAID → PAID
PENDING → OVERDUE (if past due date)
PENDING / OVERDUE → WAIVED (if loan closed)
```

### NPA (Non-Performing Asset)

A loan is flagged as NPA if:
- `status = 'DEFAULTED'`, OR
- `overdue_count > 2` (more than 2 past-due installments)

---

## 6. Loan Management — Weekly Loans

### Overview

Short-cycle weekly installment loans designed for microfinance and field collection. Created as DISBURSED immediately (no PENDING/APPROVED stage).

### Loan Number Format

`WL{YYYY}{000001}` — e.g., `WL2026000007`

### Constraints

| Field | Rule |
|-------|------|
| Principal | Must be > 0 |
| Interest Rate | 0–200% per annum (higher range than monthly) |
| Term | 1–520 weeks (up to 10 years) |
| Status at creation | `DISBURSED` (immediately active) |

### Calculation Types

#### REDUCING Balance
Standard amortization at weekly interest rate:
```
weeklyRate = annualRate / 100 / 52
EMI = P × r × (1+r)^n / ((1+r)^n - 1)
```
Each week: interest = balance × weeklyRate; principal = EMI − interest; balance reduces.

#### FLAT Rate
Simple interest divided equally:
```
totalInterest = P × weeklyRate × n
EMI = (P + totalInterest) / n
```
Each week: fixed principal + fixed interest.

### EMI Rounding

| Option | Behaviour |
|--------|-----------|
| 0 | No rounding (decimal precision) |
| 10 | Round EMI up to nearest ₹10 |
| 50 | Round EMI up to nearest ₹50 |
| 100 | Round EMI up to nearest ₹100 |

Rounding uses `ceil`: `Math.ceil(emi / nearest) * nearest`. The last installment is adjusted to clear the remaining balance exactly (avoiding floating-point drift).

### Schedule Preview

Before creating a loan, staff can call `POST /api/v1/tenant/loans/weekly/preview` to get:
- Computed EMI
- Weekly interest rate
- Total interest payable
- Total amount payable
- Full installment-by-installment schedule (number, dueDate, principalAmount, interestAmount, totalAmount)

This does not write to the database.

### Documents

At creation, two optional documents can be uploaded as base64 data URLs:
- **Security Document** (collateral / guarantee)
- **Promissory Note**

Both are stored in `security_doc_url` and `promissory_note_url` columns.

### Financial Tracking (List View)

The weekly loan list query computes real-time financial breakdown per loan from installment statuses:

| Column | Calculation |
|--------|-------------|
| `principalReceived` | SUM of principal from PAID + partial principal from PARTIALLY_PAID |
| `interestReceived` | SUM of interest from PAID + partial interest from PARTIALLY_PAID |
| `principalOutstanding` | SUM of remaining principal from PENDING/OVERDUE/PARTIALLY_PAID |
| `interestOutstanding` | SUM of remaining interest from PENDING/OVERDUE/PARTIALLY_PAID |

Interest-first allocation for partial payments:
```
interest_paid = LEAST(paid_amount, interest_amount)
principal_paid = GREATEST(0, paid_amount − interest_amount)
```

### Installment Grid UI

The weekly loan detail page shows installments as a color-coded tile grid:

| Color | Status |
|-------|--------|
| Green | PAID |
| Amber / Yellow | PARTIALLY_PAID |
| Red | OVERDUE, or PENDING with due date in the past |
| White | PENDING with future due date |
| Gray | WAIVED |

Hovering over a tile shows a tooltip with:
- Week number and due date
- Principal, Interest, Total amounts
- Amount paid (if any)
- Paid-on date
- "Paid X days late" warning if paidAt > dueDate

Clicking a payable tile (PENDING / OVERDUE / PARTIALLY_PAID) opens a payment recording modal.

---

## 7. Payment Recording & Collection

### Recording a Payment

Payments can be linked to a specific installment or recorded at loan level.

**Required fields:**
- `amount` — payment amount in INR

**Optional fields:**
- `installmentId` — if provided, updates that installment's status
- `paymentMethod` — CASH, UPI, BANK_TRANSFER, CHEQUE, NEFT, RTGS
- `referenceNumber` — UTR, cheque number, etc.
- `paymentDate` — defaults to today

### Installment Update Logic

When `installmentId` is provided:
```sql
paid_amount = paid_amount + :amount
status = CASE
  WHEN paid_amount + :amount >= total_amount THEN 'PAID'
  WHEN paid_amount + :amount > 0             THEN 'PARTIALLY_PAID'
  ELSE status
END
paid_at = CASE WHEN fully paid THEN NOW() ELSE paid_at END
```

### Payment Methods

| Code | Description |
|------|-------------|
| CASH | Physical cash |
| UPI | UPI transfer (PhonePe, GPay, etc.) |
| BANK_TRANSFER | Direct bank transfer |
| CHEQUE | Post-dated or current cheque |
| NEFT | NEFT transfer |
| RTGS | RTGS transfer |

### Restrictions

- Only APPROVED or DISBURSED loans can receive payments.
- VIEWER role cannot record payments.

---

## 8. Loan Types

### Overview

Loan Types are product templates that define pricing and term guardrails. They allow the lending company to standardize their loan products.

### Default Types (seeded on setup)

| Name | Description |
|------|-------------|
| Monthly | Standard monthly EMI loan |
| Weekly | Weekly collection cycle |
| Daily-No-Sunday | Daily collection, excluding Sundays |
| Daily-With-Sunday | Daily collection including Sundays |
| Spot | Short-duration spot loan |
| Agent-Risk | Agent-guaranteed loan |
| Monthly-EMI | EMI-based monthly product |

### Fields

| Field | Description |
|-------|-------------|
| `name` | Unique product name |
| `description` | Optional description |
| `minAmount` / `maxAmount` | Principal limits |
| `minInterestRate` / `maxInterestRate` | Rate constraints |
| `minTermMonths` / `maxTermMonths` | Tenure constraints |
| `isActive` | Enable/disable product |

### Loan Type Detail View

From the loan type detail page, staff can:
- See aggregate stats: total loans, unique customers, active principal, amount range
- **Loans tab**: paginated list of all loans under this type (with status, customer, amounts)
- **Customers tab**: unique customers who have this loan type (with loan count and active principal)

### Management Rules

- Only OWNER, MANAGER, ADMIN can create / edit / delete loan types.
- A loan type cannot be deleted if it has existing loans.
- Disable (`isActive = false`) to stop new loans under this type.

---

## 9. Branch Management

### Overview

Branches represent physical office locations of the lending company. Users, customers, and loans can be assigned to branches for geographic segmentation.

### Fields

| Field | Description |
|-------|-------------|
| `name` | Branch name |
| `code` | Unique branch code (case-insensitive) |
| `address`, `city`, `state` | Location details |
| `phone`, `email` | Branch contact |
| `managerName` | Branch manager's name |
| `isActive` | Enable/disable branch |

### Aggregates

The branch list shows real-time counts:
- Number of users assigned
- Number of customers assigned
- Number of active loans

### Management Rules

- Only ADMIN (and OWNER) can create and edit branches.
- Branches are non-deletable; use `isActive = false` to retire a branch.
- Users can be assigned to one branch; loans and customers inherit branch assignment.

### Branch Filter

All major list views (loans, weekly loans, customers) support filtering by `branchId`. LOAN_OFFICER with a branch assignment automatically scopes their view.

---

## 10. User Management

### Overview

Tenant staff accounts managed by OWNER and ADMIN roles.

### Creatable Roles

OWNER and ADMIN can create accounts with roles: ADMIN, LOAN_OFFICER, COLLECTOR, VIEWER.  
(OWNER is set at tenant creation by the super-admin and cannot be self-assigned.)

### Fields

| Field | Rule |
|-------|------|
| `email` | Required, unique (case-insensitive) |
| `phone` | Required |
| `firstName`, `lastName` | Required |
| `role` | Required (see above) |
| `password` | Required; bcrypt-hashed at rest |
| `branchId` | Optional branch assignment |

### User Detail View

The user detail page shows:
- Profile information
- Role and branch assignment
- Portfolio stats: active loans count, closed loans count, NPA loan count
- Active principal managed
- NPA principal amount
- Filterable list of their loans (by status)

### Account Operations

| Operation | Who Can Do It |
|-----------|--------------|
| Create user | OWNER, ADMIN |
| Edit user | OWNER, ADMIN |
| Deactivate user | OWNER, ADMIN (not self) |
| Activate user | OWNER, ADMIN |
| Reset password | OWNER, ADMIN |
| Change own password | Any authenticated user |

---

## 11. Notifications

### Overview

In-app notification inbox for real-time alerts on loan and payment events.

### Notification Types

| Type | Trigger |
|------|---------|
| `loan` | New loan created (notifies OWNER/MANAGER/ADMIN) |
| `payment` | Payment received (notifies loan officer + managers) |
| `info` | General information |
| `warning` | NPA or overdue alerts |
| `alert` | Critical alerts |

### Notification Structure

| Field | Description |
|-------|-------------|
| `title` | Short heading |
| `body` | Full message |
| `type` | Category (see above) |
| `entityType` | `loan`, `customer`, `payment` |
| `entityId` | UUID of related entity |
| `link` | Relative URL to navigate to |
| `isRead` | Read/unread flag |
| `createdAt` | Timestamp |

### Bell Icon (Layout)

The navigation bar shows an unread count badge on the bell icon. Clicking it opens a dropdown with recent notifications. Individual notifications can be marked as read; all can be bulk-cleared.

### API

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/tenant/notifications` | List notifications (supports `?unreadOnly=true`) |
| `GET /api/v1/tenant/notifications/unread-count` | Integer count for badge |
| `PATCH /api/v1/tenant/notifications/:id/read` | Mark one as read |
| `PATCH /api/v1/tenant/notifications/read-all` | Mark all as read |

---

## 12. Settings

### SMS Configuration

LendersHub supports SMS delivery for OTP and payment reminders via three providers:

| Provider | Notes |
|----------|-------|
| `fast2sms` | Indian bulk SMS gateway |
| `msg91` | Indian SMS platform |
| `console` | Log to console (development mode) |

Settings stored in the `settings` table as key-value pairs.

### Organisation Settings

Accessible to ADMIN+:
- Company branding (name)
- Branch management (add / edit branches)
- SMS provider configuration (API key, sender ID)

---

## 13. Database Schema

All tables live within the tenant's schema (`tenant_{subdomain}`).

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `email` | TEXT | Unique, lowercase |
| `phone` | TEXT | |
| `first_name`, `last_name` | TEXT | |
| `password` | TEXT | bcrypt hash |
| `role` | TEXT | OWNER/MANAGER/ADMIN/LOAN_OFFICER/COLLECTOR/VIEWER |
| `branch_id` | UUID FK | → branches |
| `is_active` | BOOL | Default TRUE |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `customers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `customer_code` | TEXT | Unique, auto-gen `CUST{n}` |
| `first_name`, `last_name` | TEXT | |
| `phone` | TEXT | Unique |
| `email` | TEXT | |
| `address` | TEXT | Required |
| `locality` | TEXT | Required |
| `city`, `state`, `pincode` | TEXT | |
| `pan_number` | TEXT | |
| `aadhaar_last4` | TEXT | |
| `aadhaar_doc_url` | TEXT | Base64 data URL |
| `occupation` | TEXT | |
| `loan_purpose` | TEXT | |
| `alt_contact` | TEXT | Required |
| `alt_contact_name` | TEXT | |
| `alt_contact_relation` | TEXT | |
| `credit_score` | INT | |
| `branch_id` | UUID FK | → branches |
| `is_active` | BOOL | Default TRUE |
| `deleted_at` | TIMESTAMPTZ | Soft delete |
| `created_by`, `updated_by` | UUID FK | → users |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `loans`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `loan_number` | TEXT | Unique; `LN…` or `WL…` |
| `customer_id` | UUID FK | → customers |
| `loan_officer_id` | UUID FK | → users |
| `branch_id` | UUID FK | → branches |
| `loan_type_id` | UUID FK | → loan_types |
| `principal` | NUMERIC(14,2) | |
| `interest_rate` | NUMERIC(6,2) | % per annum |
| `term_months` | INT | Also used for weeks on WEEKLY loans |
| `status` | TEXT | PENDING/APPROVED/DISBURSED/CLOSED/DEFAULTED |
| `cycle_type` | TEXT | MONTHLY (default) or WEEKLY |
| `calculation_type` | TEXT | REDUCING or FLAT |
| `emi_amount` | NUMERIC(14,2) | Computed EMI |
| `purpose` | TEXT | |
| `first_due_date` | DATE | |
| `disbursed_at` | TIMESTAMPTZ | |
| `closed_at` | TIMESTAMPTZ | |
| `security_doc_url` | TEXT | Base64 document |
| `promissory_note_url` | TEXT | Base64 document |
| `deleted_at` | TIMESTAMPTZ | Soft delete |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `installments`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `loan_id` | UUID FK | → loans |
| `installment_number` | INT | 1-based sequence |
| `due_date` | DATE | |
| `principal_amount` | NUMERIC(14,2) | |
| `interest_amount` | NUMERIC(14,2) | |
| `total_amount` | NUMERIC(14,2) | principal + interest |
| `paid_amount` | NUMERIC(14,2) | Default 0 |
| `status` | TEXT | PENDING/PAID/PARTIALLY_PAID/OVERDUE/WAIVED |
| `paid_at` | TIMESTAMPTZ | When fully paid |
| `assigned_to` | UUID FK | → users (collector) |

### `payments`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `loan_id` | UUID FK | → loans |
| `installment_id` | UUID FK | → installments (nullable) |
| `amount` | NUMERIC(14,2) | |
| `payment_method` | TEXT | CASH/UPI/BANK_TRANSFER/CHEQUE/NEFT/RTGS |
| `reference_number` | TEXT | UTR, cheque #, etc. |
| `payment_date` | DATE | |
| `collected_by` | UUID FK | → users |
| `created_at` | TIMESTAMPTZ | |

### `branches`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | TEXT | |
| `code` | TEXT | Unique, uppercase |
| `address`, `city`, `state` | TEXT | |
| `phone`, `email` | TEXT | |
| `manager_name` | TEXT | |
| `is_active` | BOOL | Default TRUE |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `loan_types`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | TEXT | Unique |
| `description` | TEXT | |
| `min_amount`, `max_amount` | NUMERIC | |
| `min_interest_rate`, `max_interest_rate` | NUMERIC | |
| `min_term_months`, `max_term_months` | INT | |
| `is_active` | BOOL | Default TRUE |
| `deleted_at` | TIMESTAMPTZ | Soft delete |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK | → users |
| `title` | TEXT | |
| `body` | TEXT | |
| `type` | TEXT | loan/payment/info/warning/alert |
| `entity_type` | TEXT | loan/customer/payment |
| `entity_id` | UUID | |
| `link` | TEXT | Relative URL |
| `is_read` | BOOL | Default FALSE |
| `created_at` | TIMESTAMPTZ | |

### `settings`

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PK | e.g., `sms_provider`, `sms_api_key` |
| `value` | TEXT | |
| `updated_at` | TIMESTAMPTZ | |

### `otp_tokens`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `mobile` | TEXT | |
| `otp` | TEXT | |
| `purpose` | TEXT | LOGIN or RESET_PASSWORD |
| `expires_at` | TIMESTAMPTZ | |
| `used` | BOOL | Default FALSE |
| `created_at` | TIMESTAMPTZ | |

---

## 14. API Reference

All endpoints are prefixed with `/api/v1/tenant/` and require `Authorization: Bearer <token>`.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login (phone or email) |
| POST | `/auth/verify-otp` | Complete OTP 2FA |
| POST | `/auth/request-otp` | Request OTP for phone login |
| POST | `/auth/forgot-password` | Initiate password reset |
| POST | `/auth/reset-password` | Complete password reset |

### Customers

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/customers` | List customers (paginated, search, branchId) | All |
| POST | `/customers` | Create customer | LOAN_OFFICER+ |
| GET | `/customers/:id` | Customer detail | All |
| PUT | `/customers/:id` | Update customer | LOAN_OFFICER+ |

### Loans (Monthly)

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/loans` | List loans (page, limit, status, search, branchId, loanTypeId, officerId) | All |
| POST | `/loans` | Create monthly loan | LOAN_OFFICER+ |
| GET | `/loans/:id` | Loan detail (+ installments + payments) | All |
| PATCH | `/loans/:id/close` | Close loan | MANAGER+ |
| POST | `/loans/:id/payments` | Record payment | LOAN_OFFICER+ |

### Loans (Weekly)

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/loans/weekly` | List weekly loans (financial breakdown) | All |
| POST | `/loans/weekly` | Create weekly loan | LOAN_OFFICER+ |
| POST | `/loans/weekly/preview` | Preview installment schedule (no DB write) | LOAN_OFFICER+ |

### Loan Types

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/loan-types` | List all loan types | All |
| POST | `/loan-types` | Create loan type | MANAGER+ |
| GET | `/loan-types/:id` | Type detail | All |
| PATCH | `/loan-types/:id` | Update loan type | MANAGER+ |
| DELETE | `/loan-types/:id` | Soft-delete | MANAGER+ |
| GET | `/loan-types/:id/loans` | Loans under type | All |
| GET | `/loan-types/:id/customers` | Customers under type | All |

### Branches

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/branches` | List all branches | All |
| POST | `/branches` | Create branch | ADMIN+ |
| PATCH | `/branches/:id` | Update branch | ADMIN+ |

### Users

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/users` | List users (paginated, searchable) | All |
| POST | `/users` | Create user | ADMIN (not MANAGER) |
| GET | `/users/officers` | Dropdown: active loan officers | MANAGER+ |
| GET | `/users/:id` | User detail + stats | All |
| GET | `/users/:id/loans` | User's loan portfolio | All |
| PATCH | `/users/:id` | Update user | ADMIN+ |
| PATCH | `/users/:id/deactivate` | Deactivate user | ADMIN+ |
| PATCH | `/users/:id/activate` | Activate user | ADMIN+ |
| PATCH | `/users/:id/reset-password` | Force password reset | ADMIN+ |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications` | List (supports `?unreadOnly=true`) |
| GET | `/notifications/unread-count` | Integer count for badge |
| PATCH | `/notifications/:id/read` | Mark one read |
| PATCH | `/notifications/read-all` | Mark all read |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings/sms` | Get SMS config |
| PUT | `/settings/sms` | Save SMS config |

---

## 15. Frontend Page Map

All pages use shared layout (`layout.tsx`) with sidebar navigation, notification bell, and user menu.

| Route | Page | Access | Description |
|-------|------|--------|-------------|
| `/login` | Login | Public | Phone/email + password |
| `/forgot-password` | Password Reset | Public | OTP-based reset |
| `/dashboard` | Dashboard | All | KPI overview |
| `/loans` | Loan List | All | Paginated with search, status, branch filters |
| `/loans/new` | New Loan | LOAN_OFFICER+ | Monthly EMI loan form |
| `/loans/[id]` | Loan Detail | All | Installments, payments, close action |
| `/weekly-loans` | Weekly Loan List | All | Full financial breakdown table |
| `/weekly-loans/new` | New Weekly Loan | LOAN_OFFICER+ | 3-step wizard: customer → terms → documents |
| `/weekly-loans/[id]` | Weekly Loan Detail | All | Color-coded installment grid, payment recording |
| `/customers` | Customer List | All | Branch filter, search |
| `/customers/new` | New Customer | LOAN_OFFICER+ | KYC form with document upload |
| `/customers/[id]` | Customer Profile | All | View + edit; Aadhaar doc, alt contact, branch |
| `/loan-types` | Loan Types | All | List with loan/customer counts |
| `/loan-types/[id]` | Loan Type Detail | All | Tabs: Loans / Customers |
| `/users` | User List | All | Staff directory |
| `/users/[id]` | User Profile | All | Stats + loan portfolio |
| `/branches` | — | — | (Managed via /settings) |
| `/notifications` | Notification Inbox | All | Read/unread; mark-all |
| `/payments` | Payment History | All | All payments across loans |
| `/collections` | Collections | COLLECTOR+ | Field collection dashboard |
| `/accounts` | My Account | All | Profile, change password |
| `/settings` | Settings | ADMIN+ | SMS config, branch management |

### Route Architecture

Next.js serves two parallel route trees pointing to the same components:

```
/app/tenant/[subdomain]/...   ← canonical (SSR middleware rewrite target)
/app/[subdomain]/...          ← direct subdomain path (identical files)
```

Middleware rewrites `acme.lendershub.in/loans` → `/tenant/acme/loans` at the edge, so both paths render the same page. Any new page must be created in both trees.

---

## Appendix — Key Business Formulas

### Reducing Balance EMI (Monthly)
```
r  = annualRate / 100 / 12
EMI = P × r × (1+r)^n / ((1+r)^n - 1)
```

### Reducing Balance EMI (Weekly)
```
r  = annualRate / 100 / 52
EMI = P × r × (1+r)^n / ((1+r)^n - 1)
```

### Flat Rate EMI (Weekly)
```
totalInterest = P × (annualRate/100/52) × n
EMI = (P + totalInterest) / n
```

### Interest-First Payment Allocation
```
interest_paid  = MIN(paid_amount, interest_amount)
principal_paid = MAX(0, paid_amount − interest_amount)
```

### NPA Flag
```
isNpa = (status == 'DEFAULTED') OR (overdueInstallmentCount > 2)
```

### EMI Rounding (ceil to nearest)
```
roundedEMI = CEIL(EMI / nearest) × nearest
lastInstallment = remainingBalance (to clear exactly)
```
