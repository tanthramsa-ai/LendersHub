import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { TenantNotificationsService } from '../tenant/notifications/tenant-notifications.service';

interface InstallmentRow {
  id: string;
  loan_id: string;
  loan_number: string;
  installment_number: number;
  due_date: string;
  total_amount: string;
  paid_amount: string;
  status: string;
  assigned_to: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  customer_name: string;
  customer_phone: string;
  days_overdue: number;
}

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
    private notificationsSvc: TenantNotificationsService,
  ) {}

  // Runs daily at 08:00 IST (02:30 UTC)
  @Cron('30 2 * * *')
  async runDailyNotifications() {
    this.logger.log('Running daily installment notifications…');
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, subdomain: true, schemaName: true, companyName: true },
    });

    for (const tenant of tenants) {
      if (!tenant.schemaName) continue;
      try {
        await this.processTenant(tenant.schemaName, tenant.companyName);
      } catch (e) {
        this.logger.error(`Failed notifications for ${tenant.subdomain}: ${(e as Error).message}`);
      }
    }
  }

  private async processTenant(schemaName: string, companyName: string) {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

      // Get installments due today, tomorrow, or overdue + their agent info
      const res = await client.query<InstallmentRow>(`
        SELECT
          i.id, i.loan_id, l.loan_number, i.installment_number,
          i.due_date::text, i.total_amount, i.paid_amount, i.status,
          i.assigned_to,
          u.first_name || ' ' || u.last_name AS agent_name,
          u.phone AS agent_phone,
          c.first_name || ' ' || c.last_name AS customer_name,
          c.phone AS customer_phone,
          (CURRENT_DATE - i.due_date)::int AS days_overdue
        FROM installments i
        JOIN loans l ON l.id = i.loan_id
        JOIN customers c ON c.id = l.customer_id
        LEFT JOIN users u ON u.id = i.assigned_to
        WHERE i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE')
          AND (i.due_date IN ($1,$2,$3) OR i.status = 'OVERDUE')
          AND l.deleted_at IS NULL
      `, [today, tomorrow, dayAfter]);

      // Get manager IDs to notify
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      const managerIds = mgrsRes.rows.map((r) => r.id);

      for (const inst of res.rows) {
        const balance = parseFloat(inst.total_amount) - parseFloat(inst.paid_amount);
        const dueDate = new Date(inst.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

        const isDueToday = inst.due_date === today;
        const isDueTomorrow = inst.due_date === tomorrow;
        const isOverdue = inst.status === 'OVERDUE';

        // Build messages
        let agentTitle: string, agentBody: string, customerMsg: string, notifType: string;

        if (isOverdue) {
          agentTitle = `Overdue: ${inst.loan_number} — ${inst.customer_name}`;
          agentBody = `Installment #${inst.installment_number} was due ${dueDate}. Balance: ₹${balance.toLocaleString('en-IN')}.`;
          customerMsg = `Dear ${inst.customer_name}, your installment of ₹${balance.toLocaleString('en-IN')} on loan ${inst.loan_number} was due on ${dueDate} and is overdue. Please contact ${companyName} immediately.`;
          notifType = 'alert';
        } else if (isDueToday) {
          agentTitle = `Due Today: ${inst.loan_number} — ${inst.customer_name}`;
          agentBody = `Installment #${inst.installment_number} of ₹${balance.toLocaleString('en-IN')} is due today.`;
          customerMsg = `Dear ${inst.customer_name}, your installment of ₹${balance.toLocaleString('en-IN')} on loan ${inst.loan_number} is due TODAY. Please make the payment at the earliest.`;
          notifType = 'warning';
        } else {
          agentTitle = `Due Tomorrow: ${inst.loan_number} — ${inst.customer_name}`;
          agentBody = `Installment #${inst.installment_number} of ₹${balance.toLocaleString('en-IN')} is due on ${dueDate}.`;
          customerMsg = `Dear ${inst.customer_name}, your installment of ₹${balance.toLocaleString('en-IN')} on loan ${inst.loan_number} is due on ${dueDate}. Please be ready for payment.`;
          notifType = 'info';
        }

        // In-app notification for assigned agent
        if (inst.assigned_to) {
          await TenantNotificationsService.insertNotification(client, {
            userId: inst.assigned_to,
            title: agentTitle,
            body: agentBody,
            type: notifType as 'info' | 'warning' | 'alert',
            entityType: 'installment',
            entityId: inst.id,
            link: `/loans/${inst.loan_id}`,
          });

          // WhatsApp to agent
          if (inst.agent_phone) {
            try {
              await this.whatsapp.send(
                inst.agent_phone,
                `[${companyName}] ${agentTitle}\n${agentBody}`,
                schemaName,
              );
            } catch (e) {
              this.logger.warn(`WhatsApp to agent failed: ${(e as Error).message}`);
            }
          }
        }

        // In-app notification for managers (only for overdue + today)
        if ((isOverdue || isDueToday) && managerIds.length) {
          for (const mgId of managerIds) {
            if (mgId === inst.assigned_to) continue; // skip if manager is also the agent
            await TenantNotificationsService.insertNotification(client, {
              userId: mgId,
              title: agentTitle,
              body: agentBody,
              type: notifType as 'info' | 'warning' | 'alert',
              entityType: 'installment',
              entityId: inst.id,
              link: `/loans/${inst.loan_id}`,
            });
          }
        }

        // WhatsApp to customer (due today or overdue only)
        if ((isDueToday || isOverdue) && inst.customer_phone) {
          try {
            await this.whatsapp.send(inst.customer_phone, customerMsg, schemaName);
          } catch (e) {
            this.logger.warn(`WhatsApp to customer failed: ${(e as Error).message}`);
          }
        }
      }

      this.logger.log(`Processed ${res.rows.length} installments for schema: ${schemaName}`);
    } finally {
      client.release();
    }
  }

  // Manual trigger endpoint — can be called from controller for testing
  async triggerManually(schemaName: string, companyName: string) {
    return this.processTenant(schemaName, companyName);
  }
}
