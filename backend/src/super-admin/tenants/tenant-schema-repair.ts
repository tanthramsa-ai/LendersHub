import { createHash } from 'crypto';
import { tenantSchemaDDL } from './tenant-schema';

/**
 * Re-applying tenantSchemaDDL() to already-provisioned tenant schemas.
 *
 * provisionSchema() runs exactly once, at tenant creation. Every column, enum
 * value or table added to tenantSchemaDDL() afterwards therefore reaches new
 * tenants only — existing ones keep working until some code path touches the
 * missing thing and 500s. That has bitten this codebase repeatedly (the AGENT
 * enum value, the NPA columns, customers.status, and most recently
 * payments.receipt_number, which broke recording a payment and both ledger
 * views at once).
 *
 * The DDL is written to be idempotent, so the fix is simply to re-run it. This
 * module is the one implementation of "re-run it", shared by the boot-time
 * repair (TenantSchemaRepairService) and scripts/repair-tenant-schemas.js, so
 * the two can't drift.
 *
 * Deliberately free of Nest and Prisma imports: the script consumes it from
 * dist/ with nothing but a `pg` client.
 */

/** The minimum surface this module needs — satisfied by both pg.Client and pg.PoolClient. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface RepairResult {
  schemaName: string;
  /** True when the schema was already at the current DDL fingerprint and nothing ran. */
  skipped: boolean;
  statements: number;
  applied: number;
  failures: { sql: string; message: string }[];
}

/**
 * Fingerprint of the DDL itself, computed against a fixed placeholder schema
 * name so every tenant shares one hash. Recorded per schema after a clean
 * repair; an unchanged fingerprint on the next boot means there is nothing new
 * to apply and the whole pass can be skipped.
 *
 * Skipping matters: the DDL includes ALTER COLUMN ... TYPE statements that
 * rewrite a table under an ACCESS EXCLUSIVE lock. Cheap once, but not
 * something to repeat on every restart of every deployment.
 */
export function ddlFingerprint(): string {
  const ddl = tenantSchemaDDL('__fingerprint__').join(';\n');
  return createHash('sha256').update(ddl).digest('hex').slice(0, 32);
}

/**
 * Bookkeeping table for the above, in `public` alongside `tenants`. Created on
 * demand so no migration is needed to adopt this.
 */
export async function ensureRepairLedger(client: SqlClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public."tenant_schema_repair" (
      schema_name  TEXT        PRIMARY KEY,
      ddl_hash     TEXT        NOT NULL,
      statements   INTEGER     NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/** Tenant schemas to repair — every provisioned tenant, or just one subdomain. */
export async function listTenantSchemas(
  client: SqlClient,
  subdomain?: string,
): Promise<{ subdomain: string; schemaName: string }[]> {
  const res = await client.query(
    subdomain
      ? `SELECT subdomain, schema_name FROM public.tenants WHERE subdomain = $1 AND schema_name IS NOT NULL ORDER BY subdomain`
      : `SELECT subdomain, schema_name FROM public.tenants WHERE schema_name IS NOT NULL ORDER BY subdomain`,
    subdomain ? [subdomain] : [],
  );
  return (res.rows as { subdomain: string; schema_name: string }[]).map((r) => ({
    subdomain: r.subdomain,
    schemaName: r.schema_name,
  }));
}

/**
 * Re-applies the DDL to one schema.
 *
 * Each statement runs independently rather than aborting the schema on the
 * first error: a schema old enough to be missing one thing is usually missing
 * several, and bailing early means finding them one painful 500 at a time.
 *
 * The fingerprint is recorded only on a clean pass, so a partially-failed
 * repair is retried on the next boot instead of being marked done.
 */
export async function repairTenantSchema(
  client: SqlClient,
  schemaName: string,
  options: { force?: boolean; fingerprint?: string } = {},
): Promise<RepairResult> {
  const fingerprint = options.fingerprint ?? ddlFingerprint();

  if (!options.force) {
    const res = await client.query(`SELECT ddl_hash FROM public."tenant_schema_repair" WHERE schema_name = $1`, [
      schemaName,
    ]);
    const row = res.rows[0] as { ddl_hash: string } | undefined;
    if (row?.ddl_hash === fingerprint) {
      return { schemaName, skipped: true, statements: 0, applied: 0, failures: [] };
    }
  }

  const statements = tenantSchemaDDL(schemaName);
  const failures: { sql: string; message: string }[] = [];
  for (const sql of statements) {
    try {
      await client.query(sql);
    } catch (e) {
      failures.push({
        sql: sql.replace(/\s+/g, ' ').trim().slice(0, 120),
        message: (e as Error).message,
      });
    }
  }

  if (failures.length === 0) {
    await client.query(
      `INSERT INTO public."tenant_schema_repair" (schema_name, ddl_hash, statements, applied_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (schema_name) DO UPDATE
         SET ddl_hash = EXCLUDED.ddl_hash, statements = EXCLUDED.statements, applied_at = NOW()`,
      [schemaName, fingerprint, statements.length],
    );
  }

  return {
    schemaName,
    skipped: false,
    statements: statements.length,
    applied: statements.length - failures.length,
    failures,
  };
}

/** Repairs every tenant schema (or one, by subdomain). Never throws per-schema. */
export async function repairAllTenantSchemas(
  client: SqlClient,
  options: { force?: boolean; subdomain?: string } = {},
): Promise<RepairResult[]> {
  await ensureRepairLedger(client);
  const fingerprint = ddlFingerprint();
  const tenants = await listTenantSchemas(client, options.subdomain);

  const results: RepairResult[] = [];
  for (const t of tenants) {
    results.push(await repairTenantSchema(client, t.schemaName, { force: options.force, fingerprint }));
  }
  return results;
}
