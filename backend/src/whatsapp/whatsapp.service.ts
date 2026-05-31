import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type WhatsAppProvider = 'console' | 'twilio' | 'meta' | 'wati';

interface WhatsAppConfig {
  provider: WhatsAppProvider;
  // Twilio
  accountSid?: string;
  authToken?: string;
  fromNumber?: string; // e.g. whatsapp:+14155238886
  // Meta Cloud API
  phoneNumberId?: string;
  accessToken?: string;
  // WATI
  apiUrl?: string;
  apiKey?: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private prisma: PrismaService) {}

  async send(to: string, message: string, schemaName: string): Promise<void> {
    const cfg = await this.resolveConfig(schemaName);
    const phone = to.replace(/[\s\-]/g, '');
    const e164 = phone.startsWith('+') ? phone : `+91${phone}`;

    switch (cfg.provider) {
      case 'twilio':
        await this.sendTwilio(e164, message, cfg);
        break;
      case 'meta':
        await this.sendMeta(e164, message, cfg);
        break;
      case 'wati':
        await this.sendWati(e164, message, cfg);
        break;
      default:
        this.logger.log(`[WhatsApp Console] To: ${e164} | ${message}`);
    }
  }

  private async resolveConfig(schemaName: string): Promise<WhatsAppConfig> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      const res = await client.query<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE key LIKE 'whatsapp_%'`,
      );
      const m: Record<string, string> = {};
      for (const r of res.rows) m[r.key] = r.value;

      return {
        provider: (m['whatsapp_provider'] as WhatsAppProvider) ?? 'console',
        accountSid: m['whatsapp_account_sid'],
        authToken: m['whatsapp_auth_token'],
        fromNumber: m['whatsapp_from_number'],
        phoneNumberId: m['whatsapp_phone_number_id'],
        accessToken: m['whatsapp_access_token'],
        apiUrl: m['whatsapp_api_url'],
        apiKey: m['whatsapp_api_key'],
      };
    } finally {
      client.release();
    }
  }

  private async sendTwilio(to: string, message: string, cfg: WhatsAppConfig): Promise<void> {
    if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
      this.logger.warn('Twilio WhatsApp not configured — using console');
      this.logger.log(`[WhatsApp Console] To: ${to} | ${message}`);
      return;
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      From: cfg.fromNumber.startsWith('whatsapp:') ? cfg.fromNumber : `whatsapp:${cfg.fromNumber}`,
      To: `whatsapp:${to}`,
      Body: message,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Twilio WhatsApp error: ${err}`);
    }
  }

  private async sendMeta(to: string, message: string, cfg: WhatsAppConfig): Promise<void> {
    if (!cfg.phoneNumberId || !cfg.accessToken) {
      this.logger.warn('Meta WhatsApp not configured — using console');
      this.logger.log(`[WhatsApp Console] To: ${to} | ${message}`);
      return;
    }
    const url = `https://graph.facebook.com/v19.0/${cfg.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Meta WhatsApp error: ${err}`);
    }
  }

  private async sendWati(to: string, message: string, cfg: WhatsAppConfig): Promise<void> {
    if (!cfg.apiUrl || !cfg.apiKey) {
      this.logger.warn('WATI not configured — using console');
      this.logger.log(`[WhatsApp Console] To: ${to} | ${message}`);
      return;
    }
    const phone = to.replace('+', '');
    const res = await fetch(`${cfg.apiUrl}/api/sendSessionMessage/${phone}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageText: message }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WATI error: ${err}`);
    }
  }
}
