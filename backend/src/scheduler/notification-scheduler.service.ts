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

      // Installments due today, tomorrow, or overdue + their agent info. Only loans being collected:
      // a loan awaiting approval has a schedule but nothing is due on it yet.
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
          AND l.status IN ('APPROVED','DISBURSED')
      `, [today, tomorrow, dayAfter]);

      // Get manager IDs to notify
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      const managerIds = mgrsRes.rows.map((r) => r.id);

      const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
      const fmtDate = (d: string) =>
        new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const notifyManagers = async (dto: {
        title: string; body: string; type: 'info' | 'warning' | 'alert';
        entityType: string; entityId: string; link: string;
      }, skipUserIds: Array<string | null>) => {
        for (const mgId of managerIds) {
          if (skipUserIds.includes(mgId)) continue; // a manager who is also the agent already got it
          await TenantNotificationsService.insertNotification(client, { userId: mgId, ...dto });
        }
      };
      const whatsappTo = async (phone: string | null | undefined, message: string, who: 'agent' | 'customer') => {
        if (!phone) return;
        try {
          await this.whatsapp.send(phone, message, schemaName);
        } catch (e) {
          this.logger.warn(`WhatsApp to ${who} failed: ${(e as Error).message}`);
        }
      };

      // Overdue installments are summarised ONCE PER LOAN. A borrower who is 20 installments behind used to get
      // 20 WhatsApps a day, and every manager 20 in-app notifications; with approved loans now ageing into
      // OVERDUE that would have been a flood on the first run. Due today / tomorrow stay one per installment.
      const overdueByLoan = new Map<string, InstallmentRow[]>();
      const upcoming: InstallmentRow[] = [];
      for (const inst of res.rows) {
        if (inst.status === 'OVERDUE') {
          const group = overdueByLoan.get(inst.loan_id);
          if (group) group.push(inst);
          else overdueByLoan.set(inst.loan_id, [inst]);
        } else {
          upcoming.push(inst);
        }
      }

      for (const group of overdueByLoan.values()) {
        group.sort((a, b) => a.installment_number - b.installment_number);
        const first = group[0];
        const count = group.length;
        const balance = Math.round(group.reduce((n, i) => n + parseFloat(i.total_amount) - parseFloat(i.paid_amount), 0) * 100) / 100;
        const oldest = fmtDate(group.reduce((d, i) => (i.due_date < d ? i.due_date : d), first.due_date));

        const agentTitle = `Overdue: ${first.loan_number} — ${first.customer_name}`;
        const agentBody = count === 1
          ? `Installment #${first.installment_number} was due ${oldest}. Balance: ${inr(balance)}.`
          : `${count} installments are overdue (oldest due ${oldest}). Balance: ${inr(balance)}.`;
        const customerMsg = count === 1
          ? `Dear ${first.customer_name}, your installment of ${inr(balance)} on loan ${first.loan_number} was due on ${oldest} and is overdue. Please contact ${companyName} immediately.`
          : `Dear ${first.customer_name}, ${count} installments totalling ${inr(balance)} on loan ${first.loan_number} are overdue (oldest due ${oldest}). Please contact ${companyName} immediately.`;
        const entity = count === 1
          ? { entityType: 'installment', entityId: first.id }
          : { entityType: 'loan', entityId: first.loan_id };
        const dto = { title: agentTitle, body: agentBody, type: 'alert' as const, ...entity, link: `/loans/${first.loan_id}` };

        // Each distinct agent assigned to any overdue installment of the loan hears about it once.
        const agents = new Map<string, string | null>();
        for (const i of group) if (i.assigned_to && !agents.has(i.assigned_to)) agents.set(i.assigned_to, i.agent_phone);
        for (const [agentId, agentPhone] of agents) {
          await TenantNotificationsService.insertNotification(client, { userId: agentId, ...dto });
          await whatsappTo(agentPhone, `[${companyName}] ${agentTitle}\n${agentBody}`, 'agent');
        }
        await notifyManagers(dto, [...agents.keys()]);
        await whatsappTo(first.customer_phone, customerMsg, 'customer');
      }

      for (const inst of upcoming) {
        const balance = parseFloat(inst.total_amount) - parseFloat(inst.paid_amount);
        const dueDate = fmtDate(inst.due_date);
        const isDueToday = inst.due_date === today;

        let agentTitle: string, agentBody: string, customerMsg: string, notifType: 'info' | 'warning';
        if (isDueToday) {
          agentTitle = `Due Today: ${inst.loan_number} — ${inst.customer_name}`;
          agentBody = `Installment #${inst.installment_number} of ${inr(balance)} is due today.`;
          customerMsg = `Dear ${inst.customer_name}, your installment of ${inr(balance)} on loan ${inst.loan_number} is due TODAY. Please make the payment at the earliest.`;
          notifType = 'warning';
        } else {
          agentTitle = `Due Tomorrow: ${inst.loan_number} — ${inst.customer_name}`;
          agentBody = `Installment #${inst.installment_number} of ${inr(balance)} is due on ${dueDate}.`;
          customerMsg = `Dear ${inst.customer_name}, your installment of ${inr(balance)} on loan ${inst.loan_number} is due on ${dueDate}. Please be ready for payment.`;
          notifType = 'info';
        }
        const dto = { title: agentTitle, body: agentBody, type: notifType, entityType: 'installment', entityId: inst.id, link: `/loans/${inst.loan_id}` };

        // In-app notification + WhatsApp for the assigned agent
        if (inst.assigned_to) {
          await TenantNotificationsService.insertNotification(client, { userId: inst.assigned_to, ...dto });
          await whatsappTo(inst.agent_phone, `[${companyName}] ${agentTitle}\n${agentBody}`, 'agent');
        }
        // Managers hear about what is due today (not tomorrow); the customer too
        if (isDueToday) {
          await notifyManagers(dto, [inst.assigned_to]);
          await whatsappTo(inst.customer_phone, customerMsg, 'customer');
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
