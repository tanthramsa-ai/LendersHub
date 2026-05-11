-- LendersHub Initial Schema
-- Created: 2026-05-09

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  first_name  VARCHAR(100),
  last_name   VARCHAR(100),
  role        VARCHAR(50) DEFAULT 'borrower',
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  amount          DECIMAL(12, 2) NOT NULL,
  interest_rate   DECIMAL(5, 2) NOT NULL,
  term_months     INTEGER NOT NULL,
  status          VARCHAR(50) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
