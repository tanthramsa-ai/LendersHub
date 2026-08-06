import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { USER_ADMIN_ROLES, UserRole } from '../common/roles';
import { NPA_DEFAULT_THRESHOLD, NPA_THRESHOLD_SETTING_KEY, parseNpaThreshold } from '../common/npa';

export interface SmsConfigDto {
  provider: 'fast2sms' | 'msg91' | 'console';
  apiKey: string;
  senderId?: string;
}

export interface WhatsAppConfigDto {
  provider: 'console' | 'twilio' | 'meta' | 'wati';
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  phoneNumberId?: string;
  accessToken?: string;
  apiUrl?: string;
  apiKey?: string;
}

export interface NpaConfigDto {
  /** Overdue installments at which a loan is classified NPA. */
  overdueThreshold: number;
}

@Injectable()
export class TenantSettingsService {
  constructor(
    private prisma: PrismaService,
    private activity: TenantActivityLogService,
  ) {}

  private async withSchema<T>(schemaName: string, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private assertAdmin(user: TenantJwtPayload) {
    if (!USER_ADMIN_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only admins can access settings');
  }

  async getSmsConfig(user: TenantJwtPayload) {
    this.assertAdmin(user);
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE key IN ('sms_provider','sms_api_key','sms_sender_id')`,
      );
      const map = Object.fromEntries(res.rows.map((r) => [r.key, r.value ?? '']));
      return {
        provider: (map['sms_provider'] ?? 'console') as SmsConfigDto['provider'],
        apiKey: map['sms_api_key'] ? `${map['sms_api_key'].slice(0, 4)}${'*'.repeat(Math.max(0, map['sms_api_key'].length - 4))}` : '',
        senderId: map['sms_sender_id'] ?? '',
        configured: !!map['sms_api_key'],
      };
    });
  }

  async updateSmsConfig(user: TenantJwtPayload, dto: SmsConfigDto) {
    this.assertAdmin(user);
    return this.withSchema(user.schemaName, async (client) => {
      const upsert = async (key: string, value: string | undefined) => {
        if (value === undefined) return;
        await client.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, value],
        );
      };

      await upsert('sms_provider', dto.provider);
      // Don't overwrite apiKey if caller sent masked value (contains ***)
      if (dto.apiKey && !dto.apiKey.includes('*')) {
        await upsert('sms_api_key', dto.apiKey);
      }
      if (dto.senderId !== undefined) {
        await upsert('sms_sender_id', dto.senderId);
      }

      // Metadata deliberately excludes apiKey — never persist secret values in the activity log.
      await this.activity.record(client, user, {
        action: 'settings.sms_updated',
        entityType: 'settings',
        entityLabel: 'SMS configuration',
        metadata: { provider: dto.provider },
      });

      return { message: 'SMS configuration updated' };
    });
  }

  async getNpaConfig(user: TenantJwtPayload) {
    this.assertAdmin(user);
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query<{ value: string }>(
        `SELECT value FROM settings WHERE key = $1`,
        [NPA_THRESHOLD_SETTING_KEY],
      );
      return {
        overdueThreshold: parseNpaThreshold(res.rows[0]?.value),
        defaultThreshold: NPA_DEFAULT_THRESHOLD,
        isCustom: res.rows[0]?.value != null,
      };
    });
  }

  async updateNpaConfig(user: TenantJwtPayload, dto: NpaConfigDto) {
    this.assertAdmin(user);
    const threshold = Number(dto.overdueThreshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 60) {
      throw new BadRequestException('NPA threshold must be a whole number between 1 and 60 installments');
    }
    return this.withSchema(user.schemaName, async (client) => {
      await client.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [NPA_THRESHOLD_SETTING_KEY, String(threshold)],
      );
      await this.activity.record(client, user, {
        action: 'settings.npa_updated',
        entityType: 'settings',
        entityLabel: 'NPA classification',
        metadata: { overdueThreshold: threshold },
      });
      return { message: 'NPA rule updated', overdueThreshold: threshold };
    });
  }

  async getWhatsAppConfig(user: TenantJwtPayload) {
    this.assertAdmin(user);
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE key LIKE 'whatsapp_%'`,
      );
      const m: Record<string, string> = {};
      for (const r of res.rows) m[r.key] = r.value;

      const mask = (v: string | undefined) =>
        v ? `${v.slice(0, 4)}${'*'.repeat(Math.max(0, v.length - 4))}` : '';

      return {
        provider: (m['whatsapp_provider'] ?? 'console') as WhatsAppConfigDto['provider'],
        accountSid: mask(m['whatsapp_account_sid']),
        authToken: mask(m['whatsapp_auth_token']),
        fromNumber: m['whatsapp_from_number'] ?? '',
        phoneNumberId: m['whatsapp_phone_number_id'] ?? '',
        accessToken: mask(m['whatsapp_access_token']),
        apiUrl: m['whatsapp_api_url'] ?? '',
        apiKey: mask(m['whatsapp_api_key']),
        configured: !!m['whatsapp_provider'] && m['whatsapp_provider'] !== 'console',
      };
    });
  }

  async updateWhatsAppConfig(user: TenantJwtPayload, dto: WhatsAppConfigDto) {
    this.assertAdmin(user);
    return this.withSchema(user.schemaName, async (client) => {
      const upsert = async (key: string, value: string | undefined) => {
        if (value === undefined) return;
        await client.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, value],
        );
      };

      const isNew = (v: string | undefined) => v && !v.includes('*');

      await upsert('whatsapp_provider', dto.provider);
      if (isNew(dto.accountSid)) await upsert('whatsapp_account_sid', dto.accountSid);
      if (isNew(dto.authToken)) await upsert('whatsapp_auth_token', dto.authToken);
      if (dto.fromNumber !== undefined) await upsert('whatsapp_from_number', dto.fromNumber);
      if (dto.phoneNumberId !== undefined) await upsert('whatsapp_phone_number_id', dto.phoneNumberId);
      if (isNew(dto.accessToken)) await upsert('whatsapp_access_token', dto.accessToken);
      if (dto.apiUrl !== undefined) await upsert('whatsapp_api_url', dto.apiUrl);
      if (isNew(dto.apiKey)) await upsert('whatsapp_api_key', dto.apiKey);

      // Metadata deliberately excludes tokens/keys — never persist secret values in the activity log.
      await this.activity.record(client, user, {
        action: 'settings.whatsapp_updated',
        entityType: 'settings',
        entityLabel: 'WhatsApp configuration',
        metadata: { provider: dto.provider },
      });

      return { message: 'WhatsApp configuration updated' };
    });
  }
}
