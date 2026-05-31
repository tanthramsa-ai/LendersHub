# Database Schema Reference

LendersHub uses a single PostgreSQL database (`lendershub`) with two schema layers:

- **`public`** — platform-level tables, managed by Prisma migrations
- **`tenant_<subdomain>`** — one schema per tenant, managed by `tenantSchemaDDL()` in code

---

## Public Schema (`public`)

### `tenants`

Holds every organisation registered on the platform.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key |
| `company_name` | TEXT | NOT NULL | — | Display name |
| `subdomain` | TEXT | NOT NULL | — | Unique URL slug (`acme` → `acme.lendershub.com`) |
| `registration_number` | TEXT | NOT NULL | — | Company registration number |
| `gst_number` | TEXT | ✓ | — | GST number |
| `address` | TEXT | NOT NULL | — | Registered address |
| `city` | TEXT | ✓ | — | |
| `state` | TEXT | ✓ | — | |
| `admin_email` | TEXT | NOT NULL | — | Primary contact email |
| `primary_color` | TEXT | ✓ | — | Hex brand colour |
| `custom_domain` | TEXT | ✓ | — | Custom hostname |
| `features` | JSON | ✓ | — | Feature-flag overrides |
| `status` | `tenant_status` | NOT NULL | `PROVISIONING` | Lifecycle state |
| `schema_name` | TEXT | ✓ | — | PostgreSQL schema name (`tenant_<subdomain>`) |
| `plan` | `subscription_plan` | ✓ | — | `STARTER` / `PROFESSIONAL` / `ENTERPRISE` |
| `billing_cycle` | `billing_cycle` | ✓ | — | `MONTHLY` / `QUARTERLY` / `ANNUALLY` |
| `trial_days` | INT | ✓ | — | Trial length in days |
| `trial_ends_at` | TIMESTAMPTZ | ✓ | — | |
| `subscription_starts_at` | TIMESTAMPTZ | ✓ | — | |
| `monthly_amount` | DECIMAL(10,2) | ✓ | — | Billed amount |
| `subscription_status` | `subscription_status` | ✓ | — | `TRIAL` / `ACTIVE` / `PAST_DUE` / `CANCELLED` |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | auto-update | |

**Indexes:** `UNIQUE (subdomain)`

---

### `users` (public)

Super-admin accounts only. Tenant staff live in their own schema.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | TEXT (UUID) | NOT NULL | `uuid()` | Primary key |
| `email` | TEXT | NOT NULL | — | Unique login email |
| `password` | TEXT | NOT NULL | — | bcrypt hash |
| `first_name` | TEXT | ✓ | — | |
| `last_name` | TEXT | ✓ | — | |
| `role` | `Role` | NOT NULL | `BORROWER` | `SUPER_ADMIN` for platform admins |
| `tenant_id` | TEXT | ✓ | — | FK → `tenants.id` |
| `totp_secret` | TEXT | ✓ | — | Base32-encoded TOTP secret (2FA) |
| `totp_enabled` | BOOLEAN | NOT NULL | `false` | Whether TOTP 2FA is active |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | auto-update | |

**Indexes:** `UNIQUE (email)`

---

### `login_audit_logs`

Tracks every login attempt (success and failure) for security auditing.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | TEXT (UUID) | NOT NULL | Primary key |
| `user_id` | TEXT | ✓ | FK → `users.id` (null if user not found) |
| `email` | TEXT | NOT NULL | Attempted email |
| `ip_address` | TEXT | NOT NULL | Client IP |
| `success` | BOOLEAN | NOT NULL | Whether login succeeded |
| `reason` | TEXT | ✓ | Failure reason |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

---

### Public Enums

| Enum | Values |
|---|---|
| `Role` | `BORROWER`, `LENDER`, `ADMIN`, `SUPER_ADMIN` |
| `tenant_status` | `PROVISIONING`, `ACTIVE`, `SUSPENDED`, `FAILED` |
| `subscription_plan` | `STARTER`, `PROFESSIONAL`, `ENTERPRISE` |
| `billing_cycle` | `MONTHLY`, `QUARTERLY`, `ANNUALLY` |
| `subscription_status` | `TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELLED` |
| `LoanStatus` (legacy) | `PENDING`, `APPROVED`, `REJECTED`, `ACTIVE`, `CLOSED` |

---

---

## Per-Tenant Schema (`tenant_<subdomain>`)

Each tenant has its own isolated schema. The tables below are identical in every tenant schema. All UUIDs use `gen_random_uuid()`.

### Enums (per-tenant)

| Enum | Values |
|---|---|
| `user_role` | `OWNER`, `MANAGER`, `ADMIN`, `LOAN_OFFICER`, `COLLECTOR`, `VIEWER` |
| `loan_status` | `PENDING`, `APPROVED`, `DISBURSED`, `CLOSED`, `DEFAULTED`, `REJECTED` |
| `installment_status` | `PENDING`, `PAID`, `PARTIALLY_PAID`, `OVERDUE`, `WAIVED` |
| `payment_method` | `CASH`, `UPI`, `BANK_TRANSFER`, `CHEQUE`, `NEFT`, `RTGS` |
| `otp_purpose` | `LOGIN`, `RESET_PASSWORD` |

---

### `users` (tenant)

Tenant staff accounts (loan officers, collectors, admins, etc.).

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | Primary key |
| `email` | TEXT | NOT NULL | — | Login email (unique per tenant) |
| `password` | TEXT | NOT NULL | — | bcrypt hash |
| `first_name` | TEXT | NOT NULL | — | |
| `last_name` | TEXT | NOT NULL | — | |
| `phone` | TEXT | ✓ | — | Mobile number; triggers OTP flow on login |
| `role` | `user_role` | NOT NULL | `VIEWER` | Access level |
| `branch_id` | UUID | ✓ | — | FK → `branches.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NOT NULL | `true` | Soft-disable without deleting |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `UNIQUE (email)`, `idx_*_users_email`, `idx_*_users_role`

---

### `customers`

Borrowers / loan applicants. One row per individual.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `customer_code` | TEXT | NOT NULL | — | Auto-generated code e.g. `CUST00042` (unique) |
| `first_name` | TEXT | NOT NULL | — | |
| `last_name` | TEXT | NOT NULL | — | |
| `email` | TEXT | ✓ | — | |
| `phone` | TEXT | NOT NULL | — | Primary mobile (unique index) |
| `pan_number` | TEXT | ✓ | — | PAN card number |
| `aadhaar_last4` | CHAR(4) | ✓ | — | Last 4 digits of Aadhaar |
| `aadhaar_doc_url` | TEXT | ✓ | — | Link to uploaded Aadhaar document |
| `date_of_birth` | DATE | ✓ | — | |
| `address` | TEXT | ✓ | — | Street / building address |
| `locality` | TEXT | ✓ | — | Neighbourhood / locality |
| `city` | TEXT | ✓ | — | |
| `state` | TEXT | ✓ | — | |
| `pincode` | CHAR(6) | ✓ | — | |
| `occupation` | TEXT | ✓ | — | |
| `loan_purpose` | TEXT | ✓ | — | Primary reason for borrowing |
| `alt_contact` | TEXT | ✓ | — | Alternate mobile number |
| `alt_contact_name` | TEXT | ✓ | — | Name of alternate contact |
| `alt_contact_relation` | TEXT | ✓ | — | Relationship (e.g. Spouse, Father) |
| `credit_score` | SMALLINT | ✓ | — | Internal credit score (0–999) |
| `branch_id` | UUID | ✓ | — | FK → `branches.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NOT NULL | `true` | |
| `deleted_at` | TIMESTAMPTZ | ✓ | — | Soft delete timestamp |
| `created_by` | UUID | ✓ | — | FK → `users.id` ON DELETE SET NULL |
| `updated_by` | UUID | ✓ | — | FK → `users.id` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `UNIQUE (customer_code)`, `idx_*_customers_phone`, `idx_*_customers_pan`, `idx_*_customers_name`

---

### `branches`

Physical or virtual branch offices.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `name` | TEXT | NOT NULL | — | Display name |
| `code` | TEXT | NOT NULL | — | Short code e.g. `CHN-001` (unique, uppercase) |
| `address` | TEXT | ✓ | — | |
| `city` | TEXT | ✓ | — | |
| `state` | TEXT | ✓ | — | |
| `phone` | TEXT | ✓ | — | Branch phone number |
| `email` | TEXT | ✓ | — | Branch email |
| `manager_name` | TEXT | ✓ | — | Name of branch manager |
| `is_active` | BOOLEAN | NOT NULL | `true` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `UNIQUE (code)`, `idx_*_branches_active`

---

### `loan_types`

Loan product catalogue. Defines allowed ranges for each product.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `name` | TEXT | NOT NULL | — | e.g. "Personal Loan", "Gold Loan" (unique) |
| `description` | TEXT | ✓ | — | |
| `min_amount` | NUMERIC(14,2) | ✓ | — | |
| `max_amount` | NUMERIC(14,2) | ✓ | — | |
| `min_interest_rate` | NUMERIC(6,4) | ✓ | — | % per annum |
| `max_interest_rate` | NUMERIC(6,4) | ✓ | — | % per annum |
| `min_term_months` | SMALLINT | ✓ | — | |
| `max_term_months` | SMALLINT | ✓ | — | |
| `is_active` | BOOLEAN | NOT NULL | `true` | |
| `deleted_at` | TIMESTAMPTZ | ✓ | — | Soft delete |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `UNIQUE (name)`

---

### `loans`

One row per loan. Supports multiple repayment cycle types.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `loan_number` | TEXT | NOT NULL | — | Human-readable ID e.g. `WL2026000021` (unique) |
| `customer_id` | UUID | NOT NULL | — | FK → `customers.id` ON DELETE RESTRICT |
| `loan_officer_id` | UUID | ✓ | — | FK → `users.id` ON DELETE SET NULL |
| `branch_id` | UUID | ✓ | — | FK → `branches.id` ON DELETE SET NULL |
| `loan_type_id` | UUID | ✓ | — | FK → `loan_types.id` ON DELETE SET NULL |
| `principal` | NUMERIC(14,2) | NOT NULL | — | Disbursed amount |
| `interest_rate` | NUMERIC(6,4) | NOT NULL | — | % per annum |
| `term_months` | SMALLINT | NOT NULL | — | Tenure (weeks for weekly loans) |
| `emi_amount` | NUMERIC(14,2) | ✓ | — | Calculated EMI / weekly / daily instalment |
| `cycle_type` | TEXT | NOT NULL | `MONTHLY` | `WEEKLY`, `DAILY`, `MONTHLY`, `AGENT_RISK`, `TERM_LOAN` |
| `calculation_type` | TEXT | NOT NULL | `REDUCING` | `REDUCING` or `FLAT` |
| `status` | `loan_status` | NOT NULL | `PENDING` | Lifecycle state |
| `purpose` | TEXT | ✓ | — | Loan purpose |
| `first_due_date` | DATE | ✓ | — | Date of first instalment |
| `security_doc_url` | TEXT | ✓ | — | URL to security document |
| `promissory_note_url` | TEXT | ✓ | — | URL to promissory note |
| `disbursed_at` | TIMESTAMPTZ | ✓ | — | Disbursement timestamp |
| `closed_at` | TIMESTAMPTZ | ✓ | — | Closure timestamp |
| `deleted_at` | TIMESTAMPTZ | ✓ | — | Soft delete |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Loan number prefixes:** `LN` (standard), `WL` (weekly), `DL` (daily), `ML` (monthly), `AR` (agent-risk), `TL` (term loan)

**Indexes:** `UNIQUE (loan_number)`, `idx_*_loans_customer`, `idx_*_loans_officer`, `idx_*_loans_status`

---

### `installments`

Auto-generated repayment schedule for each loan. One row per instalment.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `loan_id` | UUID | NOT NULL | — | FK → `loans.id` ON DELETE CASCADE |
| `installment_number` | SMALLINT | NOT NULL | — | 1-based sequence number |
| `due_date` | DATE | NOT NULL | — | Payment due date |
| `principal_amount` | NUMERIC(14,2) | NOT NULL | — | Principal portion |
| `interest_amount` | NUMERIC(14,2) | NOT NULL | — | Interest portion |
| `total_amount` | NUMERIC(14,2) | NOT NULL | — | `principal + interest` |
| `paid_amount` | NUMERIC(14,2) | NOT NULL | `0` | Running total of payments received |
| `status` | `installment_status` | NOT NULL | `PENDING` | Lifecycle state |
| `paid_at` | TIMESTAMPTZ | ✓ | — | Set when fully paid |
| `assigned_to` | UUID | ✓ | — | FK → `users.id` ON DELETE SET NULL — collection agent |
| `deleted_at` | TIMESTAMPTZ | ✓ | — | Soft delete |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `UNIQUE (loan_id, installment_number)`, `idx_*_installments_loan`, `idx_*_installments_due`, `idx_*_installments_status`

---

### `payments`

Every payment received against an instalment. Multiple partial payments per instalment are allowed.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `loan_id` | UUID | NOT NULL | — | FK → `loans.id` ON DELETE RESTRICT |
| `installment_id` | UUID | ✓ | — | FK → `installments.id` ON DELETE SET NULL |
| `amount` | NUMERIC(14,2) | NOT NULL | — | Amount received |
| `payment_method` | `payment_method` | NOT NULL | `CASH` | Collection channel |
| `reference_number` | TEXT | ✓ | — | Cheque / UTR / UPI ref |
| `collected_by` | UUID | ✓ | — | FK → `users.id` ON DELETE SET NULL |
| `payment_date` | DATE | NOT NULL | `CURRENT_DATE` | Date payment was received |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `idx_*_payments_loan`, `idx_*_payments_installment`, `idx_*_payments_date`

---

### `otp_tokens`

Short-lived OTP codes for login and password reset.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `user_id` | UUID | ✓ | — | FK → `users.id` ON DELETE CASCADE |
| `mobile` | TEXT | NOT NULL | — | Phone number the OTP was sent to |
| `otp` | CHAR(6) | NOT NULL | — | 6-digit numeric code |
| `purpose` | `otp_purpose` | NOT NULL | `LOGIN` | `LOGIN` or `RESET_PASSWORD` |
| `expires_at` | TIMESTAMPTZ | NOT NULL | — | 10 minutes after creation |
| `used` | BOOLEAN | NOT NULL | `false` | Single-use flag |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `idx_*_otp_mobile (mobile, purpose)`, `idx_*_otp_expires (expires_at)`

**Business rules:**
- When a new OTP is issued for a `(user_id, purpose)`, all previous unused OTPs for that pair are marked `used = true`
- Expired OTPs are never cleaned automatically — query always filters `expires_at > NOW()`

---

### `notifications`

In-app notification inbox. One row per notification per user.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `user_id` | UUID | NOT NULL | — | FK → `users.id` ON DELETE CASCADE |
| `title` | TEXT | NOT NULL | — | Short heading |
| `body` | TEXT | NOT NULL | — | Full message |
| `type` | TEXT | NOT NULL | `info` | `loan`, `payment`, `info`, `alert` |
| `entity_type` | TEXT | ✓ | — | e.g. `loan`, `customer` |
| `entity_id` | TEXT | ✓ | — | UUID of the related entity |
| `link` | TEXT | ✓ | — | Relative URL for deep-link |
| `is_read` | BOOLEAN | NOT NULL | `false` | |
| `read_at` | TIMESTAMPTZ | ✓ | — | |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `idx_*_notif_user (user_id, is_read, created_at DESC)`, `idx_*_notif_entity (entity_type, entity_id)`

---

### `settings`

Key-value store for per-tenant configuration (SMS credentials, WhatsApp config).

| Column | Type | Nullable | Description |
|---|---|---|---|
| `key` | TEXT | NOT NULL (PK) | Setting name e.g. `sms_config`, `whatsapp_config` |
| `value` | TEXT | ✓ | JSON-encoded value |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

---

### `fund_transactions`

Ledger of all credits and debits through the branch/organisation.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | — | Primary key |
| `transaction_date` | DATE | NOT NULL | `CURRENT_DATE` | |
| `type` | TEXT | NOT NULL | — | `CREDIT` or `DEBIT` (CHECK constraint) |
| `amount` | NUMERIC(15,2) | NOT NULL | — | Must be > 0 (CHECK constraint) |
| `category` | TEXT | NOT NULL | — | e.g. `LOAN_DISBURSEMENT`, `EMI_COLLECTION`, `EXPENSE` |
| `account_name` | TEXT | ✓ | — | Bank / cash account name |
| `entity_type` | TEXT | ✓ | — | Related entity type (`loan`, `customer`) |
| `entity_id` | TEXT | ✓ | — | Related entity UUID |
| `entity_name` | TEXT | ✓ | — | Denormalised name for display |
| `description` | TEXT | ✓ | — | Free-text note |
| `reference_number` | TEXT | ✓ | — | Cheque / UTR / ref |
| `created_by` | UUID | ✓ | — | FK → `users.id` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**Indexes:** `idx_*_ft_date (transaction_date DESC)`, `idx_*_ft_type (type, transaction_date DESC)`

---

## Entity Relationships (per-tenant)

```
branches ──┬── users (branch_id)
           ├── customers (branch_id)
           └── loans (branch_id)

loan_types ── loans (loan_type_id)

customers ── loans (customer_id)
              └── installments (loan_id)
                    └── payments (installment_id)

users ──┬── loans (loan_officer_id)
        ├── installments (assigned_to)
        ├── payments (collected_by)
        ├── otp_tokens (user_id)
        ├── notifications (user_id)
        ├── customers (created_by, updated_by)
        └── fund_transactions (created_by)
```

---

## Useful Queries

### Check which loans are overdue today

```sql
SET search_path = "tenant_demo", public;

SELECT l.loan_number, c.first_name || ' ' || c.last_name AS customer,
       i.due_date, i.total_amount - i.paid_amount AS balance
FROM installments i
JOIN loans l ON l.id = i.loan_id
JOIN customers c ON c.id = l.customer_id
WHERE i.status = 'OVERDUE'
ORDER BY i.due_date ASC;
```

### Tenant summary (all tenants, from public schema)

```sql
SELECT t.subdomain, t.company_name, t.status,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = t.schema_name) AS table_count
FROM tenants t
ORDER BY t.created_at;
```

### User loan performance

```sql
SET search_path = "tenant_demo", public;

SELECT u.first_name || ' ' || u.last_name AS officer,
       COUNT(l.id) FILTER (WHERE l.status = 'DISBURSED') AS active,
       COUNT(l.id) FILTER (WHERE l.status = 'DEFAULTED') AS npa,
       COALESCE(SUM(l.principal) FILTER (WHERE l.status = 'DISBURSED'), 0) AS portfolio
FROM users u
LEFT JOIN loans l ON l.loan_officer_id = u.id AND l.deleted_at IS NULL
WHERE u.role IN ('LOAN_OFFICER', 'COLLECTOR')
GROUP BY u.id, u.first_name, u.last_name
ORDER BY portfolio DESC;
```

### Today's collections summary

```sql
SET search_path = "tenant_demo", public;

SELECT SUM(amount) AS collected_today, COUNT(*) AS payment_count
FROM payments
WHERE payment_date = CURRENT_DATE;
```

### Branch-wise loan book

```sql
SET search_path = "tenant_demo", public;

SELECT b.name AS branch,
       COUNT(l.id) AS total_loans,
       SUM(l.principal) AS total_principal,
       COUNT(l.id) FILTER (WHERE l.status = 'DISBURSED') AS active,
       COUNT(l.id) FILTER (WHERE l.status = 'DEFAULTED') AS npa
FROM branches b
LEFT JOIN loans l ON l.branch_id = b.id AND l.deleted_at IS NULL
GROUP BY b.id, b.name
ORDER BY b.name;
```
