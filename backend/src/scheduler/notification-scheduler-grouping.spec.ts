import { NotificationSchedulerService } from './notification-scheduler.service';
import { TenantNotificationsService } from '../tenant/notifications/tenant-notifications.service';
import { npaConsecutiveOverdueRunSql } from '../tenant/common/npa';

/**
 * Overdue installments are summarised once per loan. Before, a borrower 20 installments behind got 20
 * WhatsApps a day and every manager 20 in-app notifications, which would have been a flood on the first
 * run after approved loans started ageing into OVERDUE.
 */
const MANAGERS = ['mgr-1', 'mgr-2'];
const TODAY = new Date().toISOString().slice(0, 10);

function row(over: Record<string, unknown>) {
  return {
    id: 'i-1', loan_id: 'loan-1', loan_number: 'WL1', installment_number: 1, due_date: '2026-09-01',
    total_amount: '1000', paid_amount: '0', status: 'OVERDUE', assigned_to: 'agent-1', agent_name: 'Asha',
    agent_phone: '9000000001', customer_name: 'Ravi', customer_phone: '9000000002', days_overdue: 10, ...over,
  };
}

function setup(installments: ReturnType<typeof row>[]) {
  const query = jest.fn().mockImplementation(async (sql: string) => {
    if (/FROM installments i/.test(sql)) return { rows: installments };
    if (/FROM users/.test(sql)) return { rows: MANAGERS.map((id) => ({ id })) };
    return { rows: [] };
  });
  const client = { query, release: jest.fn() };
  const pool = { pool: { connect: jest.fn().mockResolvedValue(client) } } as never;
  const whatsapp = { send: jest.fn().mockResolvedValue(undefined) };
  const insert = jest.spyOn(TenantNotificationsService, 'insertNotification').mockResolvedValue(undefined);
  const svc = new NotificationSchedulerService(pool, whatsapp as never, {} as never);
  return { svc, whatsapp, insert };
}

afterEach(() => jest.restoreAllMocks());

describe('overdue reminders', () => {
  it('sends one notification set per loan, however many installments are overdue', async () => {
    const { svc, whatsapp, insert } = setup([
      row({ id: 'i-1', installment_number: 1, due_date: '2026-08-01' }),
      row({ id: 'i-2', installment_number: 2, due_date: '2026-08-08', total_amount: '1000', paid_amount: '250' }),
      row({ id: 'i-3', installment_number: 3, due_date: '2026-08-15' }),
    ]);
    await svc.triggerManually('tenant_x', 'Acme');

    // agent + 2 managers, once each
    expect(insert).toHaveBeenCalledTimes(3);
    const bodies = insert.mock.calls.map((c) => c[1]);
    expect(bodies.map((b) => b.userId).sort()).toEqual(['agent-1', 'mgr-1', 'mgr-2']);
    expect(bodies[0].title).toBe('Overdue: WL1 — Ravi');
    expect(bodies[0].body).toMatch(/^3 installments are overdue \(oldest due 01 Aug 2026\)\. Balance: ₹2,750\.$/);
    expect(bodies[0]).toMatchObject({ entityType: 'loan', entityId: 'loan-1', type: 'alert' });

    // agent WhatsApp once, customer WhatsApp once
    expect(whatsapp.send).toHaveBeenCalledTimes(2);
    expect(whatsapp.send.mock.calls.find((c) => c[0] === '9000000002')![1]).toMatch(/3 installments totalling ₹2,750 on loan WL1 are overdue/);
  });

  it('keeps the single-installment wording and entity when only one is overdue', async () => {
    const { svc, whatsapp, insert } = setup([row({ id: 'i-9', installment_number: 4, due_date: '2026-09-01' })]);
    await svc.triggerManually('tenant_x', 'Acme');
    const dto = insert.mock.calls[0][1];
    expect(dto.body).toMatch(/^Installment #4 was due 01 \w+ 2026\. Balance: ₹1,000\.$/);
    expect(dto).toMatchObject({ entityType: 'installment', entityId: 'i-9' });
    expect(whatsapp.send).toHaveBeenCalledTimes(2);
  });

  it('keeps separate loans separate', async () => {
    const { svc, whatsapp, insert } = setup([
      row({ id: 'a1', loan_id: 'loan-1', loan_number: 'WL1' }),
      row({ id: 'a2', loan_id: 'loan-1', loan_number: 'WL1', installment_number: 2 }),
      row({ id: 'b1', loan_id: 'loan-2', loan_number: 'WL2', customer_phone: '9000000003' }),
    ]);
    await svc.triggerManually('tenant_x', 'Acme');
    expect(insert).toHaveBeenCalledTimes(6); // (agent + 2 managers) x 2 loans
    expect(whatsapp.send.mock.calls.filter((c) => ['9000000002', '9000000003'].includes(c[0]))).toHaveLength(2); // one per customer
  });

  it('does not notify a manager twice when the manager is the assigned agent', async () => {
    const { svc, insert } = setup([row({ assigned_to: 'mgr-1' })]);
    await svc.triggerManually('tenant_x', 'Acme');
    expect(insert.mock.calls.map((c) => c[1].userId).sort()).toEqual(['mgr-1', 'mgr-2']);
  });

  it('still reminds per installment for what is due today, and tells managers and the customer', async () => {
    const { svc, whatsapp, insert } = setup([
      row({ id: 'd1', status: 'PENDING', due_date: TODAY, installment_number: 5 }),
    ]);
    await svc.triggerManually('tenant_x', 'Acme');
    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert.mock.calls[0][1]).toMatchObject({ title: 'Due Today: WL1 — Ravi', type: 'warning', entityType: 'installment', entityId: 'd1' });
    expect(whatsapp.send).toHaveBeenCalledTimes(2);
  });

  it('due tomorrow reaches only the agent', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const { svc, whatsapp, insert } = setup([row({ status: 'PENDING', due_date: tomorrow })]);
    await svc.triggerManually('tenant_x', 'Acme');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][1].userId).toBe('agent-1');
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });
});

describe('NPA predicate', () => {
  it('only counts loans being collected, so pending and rejected schedules are never NPA', () => {
    const sql = npaConsecutiveOverdueRunSql('l');
    expect(sql).toMatch(/l\.status IN \('APPROVED','DISBURSED','DEFAULTED'\)/);
  });
});
