import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SmsProvider = 'fast2sms' | 'msg91' | 'console';

export interface SmsConfig {
  provider: SmsProvider;
  apiKey: string;
  senderId?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private prisma: PrismaService) {}

  async send(mobile: string, message: string, schemaName: string): Promise<void> {
    const config = await this.resolveConfig(schemaName);

    const normalised = mobile.replace(/[\s\-]/g, '').replace(/^\+91/, '');

    switch (config.provider) {
      case 'fast2sms':
        await this.sendFast2Sms(normalised, message, config);
        break;
      case 'msg91':
        await this.sendMsg91(normalised, message, config);
        break;
      default:
        // console mode: log OTP for dev/test environments
        this.logger.log(`[SMS DEV] To: ${normalised} | Message: ${message}`);
    }
  }

  private async resolveConfig(schemaName: string): Promise<SmsConfig> {
    // Prefer tenant-specific config, fall back to env vars
    try {
      const client = await this.prisma.pool.connect();
      try {
        await client.query(`SET search_path = "${schemaName}", public`);
        const res = await client.query<{ key: string; value: string }>(
          `SELECT key, value FROM settings WHERE key IN ('sms_provider','sms_api_key','sms_sender_id')`,
        );
        const map = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
        if (map['sms_api_key']) {
          return {
            provider: (map['sms_provider'] as SmsProvider) ?? 'fast2sms',
            apiKey: map['sms_api_key'],
            senderId: map['sms_sender_id'],
          };
        }
      } finally {
        client.release();
      }
    } catch {
      // ignore — fall through to env
    }

    return {
      provider: (process.env.SMS_PROVIDER as SmsProvider) ?? 'console',
      apiKey: process.env.SMS_API_KEY ?? '',
      senderId: process.env.SMS_SENDER_ID,
    };
  }

  private async sendFast2Sms(mobile: string, message: string, cfg: SmsConfig): Promise<void> {
    // Extract 6-digit OTP from message for the OTP route
    const otpMatch = message.match(/\b(\d{6})\b/);
    const body = otpMatch
      ? { variables_values: otpMatch[1], route: 'otp', numbers: mobile }
      : { message, route: 'q', numbers: mobile, flash: 0 };

    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Fast2SMS error ${res.status}: ${text}`);
      throw new Error('SMS delivery failed');
    }

    const json = (await res.json()) as { return: boolean; message?: string[] };
    if (!json.return) {
      this.logger.error(`Fast2SMS rejected: ${JSON.stringify(json)}`);
      throw new Error('SMS delivery failed');
    }
  }

  private async sendMsg91(mobile: string, message: string, cfg: SmsConfig): Promise<void> {
    const res = await fetch('https://api.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: { authkey: cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: cfg.senderId,
        mobile: `91${mobile}`,
        otp: message.match(/\b(\d{6})\b/)?.[1],
      }),
    });

    if (!res.ok) {
      this.logger.error(`MSG91 error ${res.status}`);
      throw new Error('SMS delivery failed');
    }
  }
}
