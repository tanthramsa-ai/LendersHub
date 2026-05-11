-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "gst_number" TEXT,
    "address" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'PROVISIONING',
    "schema_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- AlterTable: add tenantId to users
ALTER TABLE "users" ADD COLUMN "tenant_id" TEXT;

-- AlterTable: add tenantId to loans
ALTER TABLE "loans" ADD COLUMN "tenant_id" TEXT;

-- AddForeignKey: users.tenant_id -> tenants.id
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: loans.tenant_id -> tenants.id
ALTER TABLE "loans" ADD CONSTRAINT "loans_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
