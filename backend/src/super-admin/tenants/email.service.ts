import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

interface WelcomeEmailParams {
  to: string;
  companyName: string;
  subdomain: string;
  temporaryPassword: string;
  loginUrl: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private from: string;
  private isEthereal = false;

  async onModuleInit() {
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      this.from = process.env.SMTP_FROM ?? 'LendersHub <noreply@lendershub.com>';
    } else {
      const account = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: { user: account.user, pass: account.pass },
      });
      this.from = `LendersHub <${account.user}>`;
      this.isEthereal = true;
      this.logger.warn('No SMTP configured — using Ethereal test account. Emails will not be delivered.');
    }
  }

  async sendWelcomeEmail(params: WelcomeEmailParams): Promise<string | null> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: params.to,
      subject: `Welcome to LendersHub — Your ${params.companyName} portal is ready`,
      html: this.welcomeTemplate(params),
    });

    if (this.isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info) || null;
      this.logger.log(`Welcome email preview: ${previewUrl}`);
      return previewUrl as string | null;
    }

    this.logger.log(`Welcome email sent to ${params.to} (messageId: ${info.messageId})`);
    return null;
  }

  private welcomeTemplate({ companyName, subdomain, to, temporaryPassword, loginUrl }: WelcomeEmailParams) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Welcome to LendersHub</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 0">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:#4f46e5;padding:32px 40px">
      <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700">LendersHub</h1>
      <p style="color:#c7d2fe;margin:8px 0 0;font-size:14px">Platform Administration</p>
    </div>
    <div style="padding:40px">
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Welcome, ${companyName}!</h2>
      <p style="color:#6b7280;margin:0 0 24px;font-size:15px">
        Your LendersHub tenant portal has been provisioned successfully. Use the credentials below to log in for the first time.
      </p>
      <div style="background:#f3f4f6;border-radius:8px;padding:20px;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="color:#6b7280;font-size:13px;padding:4px 0;width:140px">Portal URL</td>
            <td style="color:#111827;font-size:13px;font-weight:600">
              <a href="${loginUrl}" style="color:#4f46e5">${loginUrl}</a>
            </td>
          </tr>
          <tr>
            <td style="color:#6b7280;font-size:13px;padding:4px 0">Subdomain</td>
            <td style="color:#111827;font-size:13px;font-weight:600">${subdomain}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;font-size:13px;padding:4px 0">Admin Email</td>
            <td style="color:#111827;font-size:13px;font-weight:600">${to}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;font-size:13px;padding:4px 0">Temp Password</td>
            <td style="color:#111827;font-size:13px;font-weight:600;font-family:monospace">${temporaryPassword}</td>
          </tr>
        </table>
      </div>
      <p style="color:#ef4444;font-size:13px;margin:0 0 24px">
        ⚠ Please change your password immediately after first login. This temporary password expires in 24 hours.
      </p>
      <a href="${loginUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600">
        Access Your Portal →
      </a>
    </div>
    <div style="background:#f9fafb;padding:20px 40px;border-top:1px solid #f3f4f6">
      <p style="color:#9ca3af;font-size:12px;margin:0">
        This email was sent by LendersHub Super Admin. If you were not expecting this, please contact support.
      </p>
    </div>
  </div>
</body>
</html>`;
  }
}
