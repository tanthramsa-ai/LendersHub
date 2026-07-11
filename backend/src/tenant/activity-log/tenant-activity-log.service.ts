import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { safePagination } from '../../common/utils/pagination';

export interface RecordActivityInput {
  action: string;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Per-tenant activity trail — who did what inside a tenant's own workspace
 * (loan created/closed, payment recorded, customer added, user managed,
 * branch/loan-type/settings changes). Lives in each tenant's own isolated
 * schema (tenant_{subdomain}.activity_log), NOT the platform-level AuditLog
 * table (which only covers super-admin actions across tenants).
 */
@Injectable()
export class TenantActivityLogService {
  private readonly logger = new Logger(TenantActivityLogService.name);
  // Per-process cache of schemas known to already have the activity_log table,
  // so we don't re-run CREATE TABLE IF NOT EXISTS on every single write.
  private ensuredSchemas = new Set<string>();

  constructor(private prisma: PrismaService) {}

  private async withSchema<T>(schemaName: string, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async ensureTable(client: import('pg').PoolClient, schemaName: string): Promise<void> {
    if (this.ensuredSchemas.has(schemaName)) return;
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."activity_log" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id UUID,
        entity_label TEXT,
        actor_id UUID,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON "${schemaName}"."activity_log"(created_at)`,
    );
    this.ensuredSchemas.add(schemaName);
  }

  /**
   * Write one activity entry using an already-open, schema-scoped client
   * (the caller's own withSchema client). Never throws — a logging failure
   * must never block the tenant action it's describing.
   */
  async record(client: import('pg').PoolClient, user: TenantJwtPayload, entry: RecordActivityInput): Promise<void> {
    try {
      await this.ensureTable(client, user.schemaName);
      await client.query(
        `INSERT INTO activity_log (action, entity_type, entity_id, entity_label, actor_id, actor_name, actor_role, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          entry.action,
          entry.entityType,
          entry.entityId ?? null,
          entry.entityLabel ?? null,
          user.sub,
          `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
          user.role,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ],
      );
    } catch (err) {
      this.logger.error(
        `Failed to record activity "${entry.action}" for schema ${user.schemaName}: ${(err as Error)?.message}`,
      );
    }
  }

  async list(
    user: TenantJwtPayload,
    page: number,
    limit: number,
    filters: { action?: string; entityType?: string; search?: string } = {},
  ) {
    ({ page, limit } = safePagination(page, limit));

    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (filters.action) { conditions.push(`action = $${idx++}`); params.push(filters.action); }
      if (filters.entityType) { conditions.push(`entity_type = $${idx++}`); params.push(filters.entityType); }
      if (filters.search) {
        conditions.push(`(actor_name ILIKE $${idx} OR entity_label ILIKE $${idx} OR action ILIKE $${idx})`);
        params.push(`%${filters.search}%`);
        idx++;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const offset = (page - 1) * limit;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(
        `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      );
      const countRes = await client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM activity_log ${where}`, params);
      const actionsRes = await client.query<{ action: string }>(`SELECT DISTINCT action FROM activity_log ORDER BY action ASC`);

      return {
        total: parseInt(countRes.rows[0].total),
        page,
        limit,
        data: dataRes.rows.map((r) => ({
          id: r.id,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          entityLabel: r.entity_label,
          actorId: r.actor_id,
          actorName: r.actor_name,
          actorRole: r.actor_role,
          metadata: r.metadata,
          createdAt: r.created_at,
        })),
        availableActions: actionsRes.rows.map((r) => r.action),
      };
    });
  }
}
