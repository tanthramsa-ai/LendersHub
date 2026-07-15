import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import type { PoolClient } from 'pg';

export type NotificationType = 'info' | 'success' | 'warning' | 'alert' | 'payment' | 'loan';

export interface CreateNotificationDto {
  userId: string;
  title: string;
  body: string;
  type?: NotificationType;
  entityType?: string;
  entityId?: string;
  link?: string;
}

@Injectable()
export class TenantNotificationsService {
  constructor(private prisma: PrismaService) {}

  // Older tenants were provisioned before the notifications table existed in the
  // schema builder and never got it retroactively — insertNotification would throw
  // "relation notifications does not exist" (42P01), surfaced to users as a bare
  // 500. This heals the table on first use per tenant schema per process, same
  // pattern as the other runtime schema patches in tenant-loans.service.ts.
  private static ensuredSchemas = new Set<string>();

  private static async ensureTable(client: PoolClient): Promise<void> {
    const { rows } = await client.query<{ schema: string }>('SELECT current_schema() AS schema');
    const schema = rows[0]?.schema;
    if (!schema || TenantNotificationsService.ensuredSchemas.has(schema)) return;
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        title       TEXT        NOT NULL,
        body        TEXT        NOT NULL,
        type        TEXT        NOT NULL DEFAULT 'info',
        entity_type TEXT,
        entity_id   TEXT,
        link        TEXT,
        is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
        read_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications (entity_type, entity_id)`);
    TenantNotificationsService.ensuredSchemas.add(schema);
  }

  private async withSchema<T>(schemaName: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  // Called internally (from loans service, scheduler, etc.) — takes a connected client
  static async insertNotification(client: PoolClient, dto: CreateNotificationDto): Promise<void> {
    await TenantNotificationsService.ensureTable(client);
    await client.query(
      `INSERT INTO notifications (user_id, title, body, type, entity_type, entity_id, link)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [dto.userId, dto.title, dto.body, dto.type ?? 'info', dto.entityType ?? null, dto.entityId ?? null, dto.link ?? null],
    );
  }

  // Bulk-notify a list of user IDs (e.g. all managers)
  async notifyUsers(schemaName: string, userIds: string[], dto: Omit<CreateNotificationDto, 'userId'>): Promise<void> {
    if (!userIds.length) return;
    return this.withSchema(schemaName, async (client) => {
      for (const userId of userIds) {
        await TenantNotificationsService.insertNotification(client, { ...dto, userId });
      }
    });
  }

  async list(user: TenantJwtPayload, page: number, limit: number, unreadOnly: boolean) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const extraWhere = unreadOnly ? 'AND is_read = FALSE' : '';
      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(
        `SELECT id, title, body, type, entity_type, entity_id, link, is_read, read_at, created_at
           FROM notifications WHERE user_id = $3 ${extraWhere}
           ORDER BY is_read ASC, created_at DESC
           LIMIT $1 OFFSET $2`,
        [limit, offset, user.sub],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 ${extraWhere}`,
        [user.sub],
      );
      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, title: r.title, body: r.body,
          type: r.type, entityType: r.entity_type, entityId: r.entity_id,
          link: r.link, isRead: r.is_read, readAt: r.read_at, createdAt: r.created_at,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async unreadCount(user: TenantJwtPayload): Promise<{ count: number }> {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
        [user.sub],
      );
      return { count: parseInt(res.rows[0].total) };
    });
  }

  async markRead(user: TenantJwtPayload, notificationId: string): Promise<{ id: string }> {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE notifications SET is_read = TRUE, read_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING id`,
        [notificationId, user.sub],
      );
      if (!res.rows[0]) throw new NotFoundException('Notification not found');
      return { id: res.rows[0].id };
    });
  }

  async markAllRead(user: TenantJwtPayload): Promise<{ updated: number }> {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE notifications SET is_read = TRUE, read_at = NOW()
         WHERE user_id = $1 AND is_read = FALSE`,
        [user.sub],
      );
      return { updated: res.rowCount ?? 0 };
    });
  }
}
