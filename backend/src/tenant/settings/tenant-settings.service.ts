import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

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

@Injectable()
export class TenantSettingsService {
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

  async getSmsConfig(user: TenantJwtPayload) {
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

      return { message: 'SMS configuration updated' };
    });
  }

  async getWhatsAppConfig(user: TenantJwtPayload) {
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

      return { message: 'WhatsApp configuration updated' };
    });
  }
}
