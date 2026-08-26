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
       CREATE TYPE ${q}.user_role AS ENUM ('OWNER','MANAGER','ADMIN','LOAN_OFFICER','COLLECTOR','VIEWER','AGENT','STAFF','CUSTOMER');
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

    // Add OWNER and MANAGER to existing tenants (ALTER TYPE ADD VALUE is idempotent in PG 9.6+)
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'OWNER'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'MANAGER'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'AGENT'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'STAFF'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'CUSTOMER'; EXCEPTION WHEN others THEN NULL; END $$`,

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
       npa_marked_at    TIMESTAMPTZ,
       npa_marked_by    UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       npa_reason       TEXT,
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
       receipt_number   TEXT,
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

    // ── customer verification status (idempotent). Default ACTIVE so existing
    // customers aren't retroactively marked unverified; create() sets new rows
    // to IN_PROGRESS explicitly regardless of this default.
    `ALTER TABLE ${q}."customers" ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE'`,

    // ── NPA columns on loans (idempotent) ────────────────────────────────────
    // These are also declared inline in the CREATE TABLE above, which covers
    // freshly-provisioned tenants — but CREATE TABLE IF NOT EXISTS is a no-op
    // on an existing table, so tenants provisioned before NPA shipped never
    // got them. Repeating them as ALTERs is what actually backfills those.
    // Any future column added to an existing table needs the same treatment.
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS npa_marked_at TIMESTAMPTZ`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS npa_marked_by UUID REFERENCES ${q}."users" (id) ON DELETE SET NULL`,
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS npa_reason TEXT`,

    // ── receipt_number on payments (idempotent) — requirements doc §5.4/§7.3/§7.4 ──
    `ALTER TABLE ${q}."payments" ADD COLUMN IF NOT EXISTS receipt_number TEXT`,

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
    // ₹ per ₹1,000 per day — source rate for calculation_type = 'PER_1000_PER_DAY' weekly loans
    `ALTER TABLE ${q}."loans" ADD COLUMN IF NOT EXISTS interest_per_1000_per_day NUMERIC(6,2)`,
    // Collector's chosen resolution for a missed/short PER_1000_PER_DAY installment —
    // 'PAY_EXTRA_NEXT' | 'EXTEND_EMI' | 'DEFER_TO_END'. Null until explicitly resolved.
    `ALTER TABLE ${q}."installments" ADD COLUMN IF NOT EXISTS miss_resolution TEXT`,
    `DO $$ BEGIN
       ALTER TABLE ${q}."installments" ADD CONSTRAINT installments_miss_resolution_chk
         CHECK (miss_resolution IS NULL OR miss_resolution IN ('PAY_EXTRA_NEXT','EXTEND_EMI','DEFER_TO_END'));
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

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

    // ── ledger_transactions (immutable financial transaction ledger — source of
    // truth for principal/interest/fee splits, disbursements, collections,
    // adjustments and reversals. Distinct from fund_transactions, which only
    // covers ad-hoc manual credit/debit entries). Amounts on a posted row are
    // never edited; corrections are separate reversal rows linked via
    // reversal_of_id, with the original's status flipped to REVERSED. ─────────
    `CREATE TABLE IF NOT EXISTS ${q}."ledger_transactions" (
       id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
       transaction_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
       business_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
       transaction_type  TEXT          NOT NULL CHECK (transaction_type IN ('DISBURSEMENT','COLLECTION','REFUND','ADJUSTMENT','FEE','OTHER')),
       loan_id           UUID          REFERENCES ${q}."loans" (id) ON DELETE SET NULL,
       customer_id       UUID          REFERENCES ${q}."customers" (id) ON DELETE SET NULL,
       agent_id          UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       payment_id        UUID          REFERENCES ${q}."payments" (id) ON DELETE SET NULL,
       principal_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
       interest_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
       fee_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
       other_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
       total_amount      NUMERIC(14,2) NOT NULL,
       payment_channel   TEXT          CHECK (payment_channel IN ('AGENT_CASH','AGENT_UPI','BANK_TRANSFER','UPI','PAYMENT_GATEWAY','CASH','CHEQUE','NEFT','RTGS','OTHER')),
       external_reference TEXT,
       status            TEXT          NOT NULL DEFAULT 'POSTED' CHECK (status IN ('PENDING','POSTED','REVERSED','RECONCILED')),
       idempotency_key   TEXT,
       reversal_of_id    UUID          REFERENCES ${q}."ledger_transactions" (id) ON DELETE SET NULL,
       settled_at          TIMESTAMPTZ,
       settlement_reference TEXT,
       remarks           TEXT,
       created_by        UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       CONSTRAINT ck_${s}_lt_total_matches_components
         CHECK (total_amount = principal_amount + interest_amount + fee_amount + other_amount)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lt_txn_date  ON ${q}."ledger_transactions" (transaction_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lt_biz_date  ON ${q}."ledger_transactions" (business_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lt_type      ON ${q}."ledger_transactions" (transaction_type)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lt_loan      ON ${q}."ledger_transactions" (loan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lt_customer  ON ${q}."ledger_transactions" (customer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lt_payment   ON ${q}."ledger_transactions" (payment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lt_status    ON ${q}."ledger_transactions" (status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_${s}_lt_idempotency ON ${q}."ledger_transactions" (idempotency_key) WHERE idempotency_key IS NOT NULL`,

    // ── funders + funder capital ledger + explicit loan funding allocation ────
    // (ledger requirements doc §6.1/§6.2/§9 — explicit allocation model: each
    // disbursement is manually assigned to one or more specific funders,
    // rather than pooled or auto-split pro-rata.)
    `CREATE TABLE IF NOT EXISTS ${q}."funders" (
       id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       name        TEXT        NOT NULL,
       email       TEXT,
       phone       TEXT,
       is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_funders_active ON ${q}."funders" (is_active)`,

    `CREATE TABLE IF NOT EXISTS ${q}."funder_transactions" (
       id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
       funder_id         UUID          NOT NULL REFERENCES ${q}."funders" (id) ON DELETE RESTRICT,
       transaction_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
       transaction_type  TEXT          NOT NULL CHECK (transaction_type IN ('CONTRIBUTION','WITHDRAWAL','ADJUSTMENT')),
       amount            NUMERIC(14,2) NOT NULL,
       reference_number  TEXT,
       notes             TEXT,
       status            TEXT          NOT NULL DEFAULT 'POSTED' CHECK (status IN ('PENDING','POSTED','REVERSED')),
       reversal_of_id    UUID          REFERENCES ${q}."funder_transactions" (id) ON DELETE SET NULL,
       created_by        UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_funder_txn_funder ON ${q}."funder_transactions" (funder_id, transaction_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_funder_txn_status ON ${q}."funder_transactions" (status)`,

    `CREATE TABLE IF NOT EXISTS ${q}."loan_funder_allocations" (
       id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
       loan_id     UUID          NOT NULL REFERENCES ${q}."loans" (id) ON DELETE CASCADE,
       funder_id   UUID          NOT NULL REFERENCES ${q}."funders" (id) ON DELETE RESTRICT,
       amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
       created_by  UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_lfa_loan_funder UNIQUE (loan_id, funder_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lfa_loan   ON ${q}."loan_funder_allocations" (loan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_lfa_funder ON ${q}."loan_funder_allocations" (funder_id)`,

    // ── daily_ledger_snapshot (day-end materialization + informational lock —
    // requirements doc §6.5/§7.2. Generating a snapshot never blocks new
    // postings; locked_at is purely a reporting/audit marker, not enforced
    // by the posting engine.) ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS ${q}."daily_ledger_snapshot" (
       id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
       business_date                 DATE          NOT NULL,
       opening_outstanding_principal NUMERIC(14,2) NOT NULL DEFAULT 0,
       new_disbursement_principal    NUMERIC(14,2) NOT NULL DEFAULT 0,
       principal_collected           NUMERIC(14,2) NOT NULL DEFAULT 0,
       interest_collected            NUMERIC(14,2) NOT NULL DEFAULT 0,
       adjustments                   NUMERIC(14,2) NOT NULL DEFAULT 0,
       closing_outstanding_principal NUMERIC(14,2) NOT NULL DEFAULT 0,
       available_fund                NUMERIC(14,2) NOT NULL DEFAULT 0,
       generated_by                  UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       generated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       locked_at                     TIMESTAMPTZ,
       locked_by                     UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       CONSTRAINT uq_${s}_dls_date UNIQUE (business_date)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_dls_date ON ${q}."daily_ledger_snapshot" (business_date DESC)`,

    // ── incoming_payment_events (direct payment webhook staging — requirements
    // doc §7.4/§11 "POST /api/payments/webhook". Every received event lands here
    // first; matching to a loan/installment and posting the resulting ledger
    // transaction is a separate, manual step (Phase 6 scope decision — no
    // provider chosen yet, so no automatic reference-based matching either).
    // Unique on (provider, external_reference): a redelivered webhook for the
    // same payment is recognized and ignored rather than double-posted.) ──────
    `CREATE TABLE IF NOT EXISTS ${q}."incoming_payment_events" (
       id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
       provider               TEXT          NOT NULL,
       external_reference     TEXT          NOT NULL,
       amount                 NUMERIC(14,2) NOT NULL,
       currency               TEXT          NOT NULL DEFAULT 'INR',
       payment_method         TEXT,
       payer_name             TEXT,
       payer_contact          TEXT,
       occurred_at            TIMESTAMPTZ,
       raw_payload            JSONB         NOT NULL,
       status                 TEXT          NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','POSTED','REJECTED')),
       matched_loan_id        UUID          REFERENCES ${q}."loans" (id) ON DELETE SET NULL,
       matched_installment_id UUID          REFERENCES ${q}."installments" (id) ON DELETE SET NULL,
       matched_customer_id    UUID          REFERENCES ${q}."customers" (id) ON DELETE SET NULL,
       payment_id             UUID          REFERENCES ${q}."payments" (id) ON DELETE SET NULL,
       ledger_transaction_id  UUID          REFERENCES ${q}."ledger_transactions" (id) ON DELETE SET NULL,
       rejection_reason       TEXT,
       processed_by           UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
       processed_at           TIMESTAMPTZ,
       received_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       CONSTRAINT uq_${s}_ipe_provider_ref UNIQUE (provider, external_reference)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_ipe_status   ON ${q}."incoming_payment_events" (status)`,
    `CREATE INDEX IF NOT EXISTS idx_${s}_ipe_received ON ${q}."incoming_payment_events" (received_at DESC)`,

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

    // Role-model migration: merge LOAN_OFFICER/COLLECTOR into AGENT and VIEWER into STAFF.
    // Runs after the ADD VALUE statements above commit, as its own statement.
    `UPDATE ${q}."users" SET role = 'AGENT' WHERE role IN ('LOAN_OFFICER','COLLECTOR')`,
    `UPDATE ${q}."users" SET role = 'STAFF' WHERE role = 'VIEWER'`,

    // ── role_permissions (tenant-admin-editable matrix; UI reads/writes this) ──
    // permission_key/value are plain TEXT, not enums — the value vocabulary
    // differs per key (yes/no; all/self/no; yes/partial/no) and this way adding
    // a new permission_key later needs no ALTER TYPE. Seeded with the
    // authoritative matrix from the role-model overhaul; ON CONFLICT DO NOTHING
    // so re-running this (e.g. the tenant-schema repair script) never clobbers
    // an admin's own edits.
    `CREATE TABLE IF NOT EXISTS ${q}."role_permissions" (
       role           ${q}.user_role NOT NULL,
       permission_key TEXT           NOT NULL,
       value          TEXT           NOT NULL,
       updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
       PRIMARY KEY (role, permission_key)
     )`,

    `INSERT INTO ${q}."role_permissions" (role, permission_key, value) VALUES
       ('OWNER',    'add_user',        'yes'),
       ('OWNER',    'add_customer',    'yes'),
       ('OWNER',    'view_loan',       'all'),
       ('OWNER',    'add_loan',        'yes'),
       ('OWNER',    'update_loan',     'yes'),
       ('OWNER',    'view_collection', 'all'),
       ('OWNER',    'add_collection',  'yes'),

       ('ADMIN',    'add_user',        'yes'),
       ('ADMIN',    'add_customer',    'yes'),
       ('ADMIN',    'view_loan',       'all'),
       ('ADMIN',    'add_loan',        'yes'),
       ('ADMIN',    'update_loan',     'yes'),
       ('ADMIN',    'view_collection', 'all'),
       ('ADMIN',    'add_collection',  'yes'),

       ('MANAGER',  'add_user',        'no'),
       ('MANAGER',  'add_customer',    'yes'),
       ('MANAGER',  'view_loan',       'all'),
       ('MANAGER',  'add_loan',        'yes'),
       ('MANAGER',  'update_loan',     'yes'),
       ('MANAGER',  'view_collection', 'all'),
       ('MANAGER',  'add_collection',  'yes'),

       ('AGENT',    'add_user',        'no'),
       ('AGENT',    'add_customer',    'yes'),
       ('AGENT',    'view_loan',       'self'),
       ('AGENT',    'add_loan',        'partial'),
       ('AGENT',    'update_loan',     'no'),
       ('AGENT',    'view_collection', 'self'),
       ('AGENT',    'add_collection',  'yes'),

       ('STAFF',    'add_user',        'no'),
       ('STAFF',    'add_customer',    'yes'),
       ('STAFF',    'view_loan',       'all'),
       ('STAFF',    'add_loan',        'partial'),
       ('STAFF',    'update_loan',     'no'),
       ('STAFF',    'view_collection', 'all'),
       ('STAFF',    'add_collection',  'yes'),

       ('CUSTOMER', 'add_user',        'no'),
       ('CUSTOMER', 'add_customer',    'no'),
       ('CUSTOMER', 'view_loan',       'self'),
       ('CUSTOMER', 'add_loan',        'no'),
       ('CUSTOMER', 'update_loan',     'no'),
       ('CUSTOMER', 'view_collection', 'self'),
       ('CUSTOMER', 'add_collection',  'no')
     ON CONFLICT (role, permission_key) DO NOTHING`,
  ];
}
