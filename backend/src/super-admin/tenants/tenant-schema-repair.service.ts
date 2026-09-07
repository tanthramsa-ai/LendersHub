import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RepairResult, repairAllTenantSchemas } from './tenant-schema-repair';

/**
 * Applies any DDL added to tenantSchemaDDL() since a tenant was provisioned,
 * on every boot — the deploy step that stops "we shipped a new column and
 * production started 500ing" from happening again.
 *
 * scripts/repair-tenant-schemas.js remains the manual escape hatch (repair one
 * tenant, or force a pass without a restart); both call the same code in
 * tenant-schema-repair.ts.
 *
 * Cheap by default: a fingerprint of the DDL is recorded per schema, so a boot
 * whose DDL is unchanged does one SELECT per tenant and stops. Work happens
 * only on the deploy that actually changes the schema.
 *
 * Never throws. A repair failure must not take the API down with it — the
 * error is logged loudly and the affected endpoints fail as they would have
 * anyway, which is strictly better than refusing to start.
 *
 * Set SCHEMA_REPAIR_ON_BOOT=false to disable (e.g. to hand-control the timing
 * of a large migration).
 */
@Injectable()
export class TenantSchemaRepairService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantSchemaRepairService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SCHEMA_REPAIR_ON_BOOT === 'false') {
      this.logger.log('Tenant schema repair skipped (SCHEMA_REPAIR_ON_BOOT=false)');
      return;
    }
    try {
      await this.repairAll();
    } catch (e) {
      this.logger.error(`Tenant schema repair failed: ${(e as Error)?.message}`, (e as Error)?.stack);
    }
  }

  /** Also callable on demand — same pass, optionally forced or scoped to one subdomain. */
  async repairAll(options: { force?: boolean; subdomain?: string } = {}): Promise<RepairResult[]> {
    const started = Date.now();
    const client = await this.prisma.pool.connect();
    let results: RepairResult[];
    try {
      results = await repairAllTenantSchemas(client, options);
    } finally {
      client.release();
    }

    const repaired = results.filter((r) => !r.skipped);
    const failed = results.filter((r) => r.failures.length > 0);

    if (repaired.length === 0) {
      this.logger.log(`Tenant schemas up to date (${results.length} checked, ${Date.now() - started}ms)`);
    } else {
      this.logger.log(
        `Tenant schema repair: ${repaired.length}/${results.length} schema(s) updated in ${Date.now() - started}ms`,
      );
    }

    for (const r of failed) {
      this.logger.error(`Schema ${r.schemaName}: ${r.failures.length}/${r.statements} statement(s) failed`);
      for (const f of r.failures) {
        this.logger.error(`  ${f.message} — ${f.sql}`);
      }
    }

    return results;
  }
}
