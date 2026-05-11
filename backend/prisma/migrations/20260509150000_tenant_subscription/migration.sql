-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "tenants"
  ADD COLUMN "plan"                    "SubscriptionPlan",
  ADD COLUMN "billing_cycle"           "BillingCycle",
  ADD COLUMN "trial_days"              INTEGER,
  ADD COLUMN "trial_ends_at"           TIMESTAMP(3),
  ADD COLUMN "subscription_starts_at"  TIMESTAMP(3),
  ADD COLUMN "monthly_amount"          DECIMAL(10,2),
  ADD COLUMN "subscription_status"     "SubscriptionStatus";
