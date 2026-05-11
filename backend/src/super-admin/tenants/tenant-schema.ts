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
       CREATE TYPE ${q}.user_role AS ENUM ('ADMIN','LOAN_OFFICER','COLLECTOR','VIEWER');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

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
       interest_rate    NUMERIC(6,4)  NOT NULL,
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
  ];
}
