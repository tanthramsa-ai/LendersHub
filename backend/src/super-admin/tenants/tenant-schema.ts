/**
 * Returns idempotent DDL statements that provision a tenant's private PostgreSQL
 * schema.  The caller executes them sequentially via $executeRawUnsafe.
 *
 * Safety: `schemaName` is always `tenant_${subdomain}` where `subdomain` was
 * validated with /^[a-z0-9][a-z0-9-]{0,19}[a-z0-9]$/ before reaching here.
 * Double-quoting the identifier prevents any remaining SQL injection risk.
 */
export function tenantSchemaDDL(s: string): string[] {
  const q = `"${s}"`;

  return [
    `CREATE SCHEMA IF NOT EXISTS ${q}`,

    // ── Enum types (idempotent via exception handler) ────────────────────────
    `DO $$ BEGIN
       CREATE TYPE ${q}.user_role AS ENUM ('OWNER','MANAGER','ADMIN','LOAN_OFFICER','COLLECTOR','VIEWER');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

    // Add OWNER and MANAGER to existing tenants (ALTER TYPE ADD VALUE is idempotent in PG 9.6+)
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'OWNER'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'MANAGER'; EXCEPTION WHEN others THEN NULL; END $$`,

    `DO $$ BEGIN
       CREATE TYPE ${q}.loan_status AS ENUM ('PENDING','APPROVED','DISBURSED','CLOSED','DEFAULTED','REJECTED');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

    `DO $$ BEGIN
       CREATE TYPE ${q}.installment_status AS ENUM ('PENDING','PAID','PARTIALLY_PAID','OVERDUE','WAIVED');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

    `DO $$ BEGIN
       CREATE TYPE ${q}.payment_method AS ENUM ('CASH','UPI','BANK_TRANSFER','CHEQUE','NEFT','RTGS');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

    // ── users (tenant staff) ──────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."users" (
       id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       email       TEXT        NOT NULL,
       password    TEXT        NOT NULL,
       first_name  TEXT        NOT NULL,
       last_name   TEXT        NOT NULL,
       phone       TEXT,
       role        ${q}.user_role NOT NULL DEFAULT 'VIEWER',
       is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_users_email UNIQUE (email)
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_users_email ON ${q}."users" (email)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_users_role  ON ${q}."users" (role)`,

    // ── customers (borrowers) ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."customers" (
       id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
       customer_code  TEXT    NOT NULL,
       first_name     TEXT    NOT NULL,
       last_name      TEXT    NOT NULL,
       email          TEXT,
       phone          TEXT    NOT NULL,
       pan_number     TEXT,
       aadhaar_last4  CHAR(4),
       date_of_birth  DATE,
       address        TEXT,
       city           TEXT,
       state          TEXT,
       pincode        CHAR(6),
       credit_score   SMALLINT,
       is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
       created_by     UUID        REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_customers_code UNIQUE (customer_code)
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_customers_phone ON ${q}."customers" (phone)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_customers_pan   ON ${q}."customers" (pan_number)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_customers_name  ON ${q}."customers" (first_name, last_name)`,

    // ── loans ─────────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."loans" (
       id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       loan_number      TEXT         NOT NULL,
       customer_id      UUID         NOT NULL REFERENCES ${q}."customers" (id) ON DELETE RESTRICT,
       loan_officer_id  UUID         REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       principal        NUMERIC(14,2) NOT NULL,
       interest_rate    NUMERIC(7,4)  NOT NULL,
       term_months      SMALLINT      NOT NULL,
       status           ${q}.loan_status NOT NULL DEFAULT 'PENDING',
       purpose          TEXT,
       disbursed_at     TIMESTAMPTZ,
       first_due_date   DATE,
       created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_loans_number UNIQUE (loan_number)
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_loans_customer ON ${q}."loans" (customer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_loans_officer  ON ${q}."loans" (loan_officer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_loans_status   ON ${q}."loans" (status)`,

    // ── installments (repayment schedule) ────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."installments" (
       id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       loan_id             UUID         NOT NULL REFERENCES ${q}."loans" (id) ON DELETE CASCADE,
       installment_number  SMALLINT     NOT NULL,
       due_date            DATE         NOT NULL,
       principal_amount    NUMERIC(14,2) NOT NULL,
       interest_amount     NUMERIC(14,2) NOT NULL,
       total_amount        NUMERIC(14,2) NOT NULL,
       paid_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
       status              ${q}.installment_status NOT NULL DEFAULT 'PENDING',
       paid_at             TIMESTAMPTZ,
       assigned_to         UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_installments_seq UNIQUE (loan_id, installment_number)
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_installments_loan   ON ${q}."installments" (loan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_installments_due    ON ${q}."installments" (due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_installments_status ON ${q}."installments" (status)`,

    // ── payments ──────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."payments" (
       id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       loan_id          UUID         NOT NULL REFERENCES ${q}."loans" (id) ON DELETE RESTRICT,
       installment_id   UUID         REFERENCES ${q}."installments" (id) ON DELETE SET NULL,
       amount           NUMERIC(14,2) NOT NULL,
       payment_method   ${q}.payment_method NOT NULL DEFAULT 'CASH',
       reference_number TEXT,
       collected_by     UUID         REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       payment_date     DATE         NOT NULL DEFAULT CURRENT_DATE,
       created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_payments_loan        ON ${q}."payments" (loan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_payments_installment ON ${q}."payments" (installment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_payments_date        ON ${q}."payments" (payment_date)`,

    // ── branches ──────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."branches" (
       id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       name        TEXT        NOT NULL,
       code        TEXT        NOT NULL,
       address     TEXT,
       city        TEXT,
       state       TEXT,
       phone       TEXT,
       email       TEXT,
       manager_name TEXT,
       is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_branches_code UNIQUE (code)
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_branches_active ON ${q}."branches" (is_active)`,

    // ── loan_types ────────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."loan_types" (
       id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       name              TEXT         NOT NULL,
       description       TEXT,
       min_amount        NUMERIC(14,2),
       max_amount        NUMERIC(14,2),
       min_interest_rate NUMERIC(7,4),
       max_interest_rate NUMERIC(7,4),
       min_term_months   SMALLINT,
       max_term_months   SMALLINT,
       is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
       created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_loan_types_name UNIQUE (name)
     )`,

    // ── branch_id FK on existing tables (idempotent) ─────────────────────────
    `ALTER TABLE ${q}."users"     ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES ${q}."branches" (id) ON DELETE SET NULL`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES ${q}."branches" (id) ON DELETE SET NULL`,
    `ALTER TABLE ${q}."loans"     ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES ${q}."branches" (id) ON DELETE SET NULL`,

    // ── loan_type_id FK on loans (idempotent) ────────────────────────────────
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS loan_type_id UUID REFERENCES ${q}."loan_types" (id) ON DELETE SET NULL`,

    // ── closed_at timestamp on loans (idempotent) ────────────────────────────
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`,

    // ── soft delete columns (idempotent) ─────────────────────────────────────
    `ALTER TABLE ${q}."loans"        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE ${q}."customers"    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE ${q}."installments" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE ${q}."loan_types"   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,

    // ── otp_tokens ────────────────────────────────────────────────────────────
    `DO $$ BEGIN
       CREATE TYPE ${q}.otp_purpose AS ENUM ('LOGIN','RESET_PASSWORD');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

    `CREATE TABLE IF NOT EXISTS ${q}."otp_tokens" (
       id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id       UUID        REFERENCES ${q}."users" (id) ON DELETE CASCADE,
       mobile        TEXT        NOT NULL,
       otp           CHAR(6)     NOT NULL,
       purpose       ${q}.otp_purpose NOT NULL DEFAULT 'LOGIN',
       expires_at    TIMESTAMPTZ NOT NULL,
       used          BOOLEAN     NOT NULL DEFAULT FALSE,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_otp_mobile  ON ${q}."otp_tokens" (mobile, purpose)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_otp_expires ON ${q}."otp_tokens" (expires_at)`,

    // ── settings (key-value store for SMS config etc.) ───────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."settings" (
       key        TEXT PRIMARY KEY,
       value      TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,

    // ── notifications ─────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."notifications" (
       id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id     UUID        NOT NULL REFERENCES ${q}."users" (id) ON DELETE CASCADE,
       title       TEXT        NOT NULL,
       body        TEXT        NOT NULL,
       type        TEXT        NOT NULL DEFAULT 'info',
       entity_type TEXT,
       entity_id   TEXT,
       link        TEXT,
       is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
       read_at     TIMESTAMPTZ,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,

    `CREATE INDEX IF NOT EXISTS idx_${s}_notif_user   ON ${q}."notifications" (user_id, is_read, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_notif_entity ON ${q}."notifications" (entity_type, entity_id)`,

    // ── weekly loan fields on loans (idempotent) ─────────────────────────────
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS cycle_type          TEXT NOT NULL DEFAULT 'MONTHLY'`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS calculation_type    TEXT NOT NULL DEFAULT 'REDUCING'`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS emi_amount          NUMERIC(14,2)`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS security_doc_url    TEXT`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS promissory_note_url TEXT`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS close_comment       TEXT`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS reopen_comment      TEXT`,

    // Widen interest_rate so values up to 200% p.a. (and loan-type bounds) fit.
    // NUMERIC(6,4) only allowed ≤ 99.9999 and caused "Numeric value out of range".
    `ALTER TABLE ${q}."loans" ALTER COLUMN interest_rate TYPE NUMERIC(7,4)`,
    `ALTER TABLE ${q}."loan_types" ALTER COLUMN min_interest_rate TYPE NUMERIC(7,4)`,
    `ALTER TABLE ${q}."loan_types" ALTER COLUMN max_interest_rate TYPE NUMERIC(7,4)`,

    // ── customer extended fields (idempotent) ─────────────────────────────────
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS locality       TEXT`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS occupation     TEXT`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS loan_purpose   TEXT`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS alt_contact    TEXT`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS alt_contact_name TEXT`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS alt_contact_relation TEXT`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS aadhaar_doc_url TEXT`,
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS updated_by     UUID REFERENCES ${q}."users" (id) ON DELETE SET NULL`,

    // ── fund_transactions (ledger for credits/debits/principle) ───────────────
    `CREATE TABLE IF NOT EXISTS ${q}."fund_transactions" (
       id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       transaction_date DATE        NOT NULL DEFAULT CURRENT_DATE,
       type             TEXT        NOT NULL CHECK (type IN ('CREDIT','DEBIT')),
       amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
       category         TEXT        NOT NULL,
       account_name     TEXT,
       entity_type      TEXT,
       entity_id        TEXT,
       entity_name      TEXT,
       description      TEXT,
       reference_number TEXT,
       created_by       UUID        REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_ft_date  ON ${q}."fund_transactions" (transaction_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_ft_type  ON ${q}."fund_transactions" (type, transaction_date DESC)`,

    // ── activity_log (per-tenant activity trail: loans, customers, users, etc.) ─
    `CREATE TABLE IF NOT EXISTS ${q}."activity_log" (
       id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       action      TEXT        NOT NULL,
       entity_type TEXT        NOT NULL,
       entity_id   UUID,
       entity_label TEXT,
       actor_id    UUID,
       actor_name  TEXT        NOT NULL,
       actor_role  TEXT        NOT NULL,
       metadata    JSONB,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_activity_log_created_at ON ${q}."activity_log" (created_at DESC)`,
  ];
}
