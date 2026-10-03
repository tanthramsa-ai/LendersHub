import { OverdueAgeingService } from './overdue-ageing.service';
import { NotificationSchedulerService } from './notification-scheduler.service';

/**
 * Both nightly jobs must act on loans that are being collected: APPROVED (what every loan is right
 * after approval) and DISBURSED. They used to skip APPROVED, so approved loans never aged to OVERDUE,
 * and the reminder job did not look at loan status at all, notifying about loans still awaiting approval.
 */
function poolWith(query: jest.Mock) {
  const client = { query, release: jest.fn() };
  return { pool: { connect: jest.fn().mockResolvedValue(client) } } as never;
}

describe('overdue ageing job', () => {
  it('ages installments of APPROVED loans as well as DISBURSED/DEFAULTED ones', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await new OverdueAgeingService(poolWith(query)).runForTenant('tenant_x');
    const aging = query.mock.calls.map((c) => String(c[0])).find((sql) => /SET status = 'OVERDUE'/.test(sql))!;
    expect(aging).toMatch(/l\.status IN \('APPROVED','DISBURSED','DEFAULTED'\)/);
  });
});

describe('installment reminder job', () => {
  it('only selects installments of loans being collected, never pending ones', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const svc = new NotificationSchedulerService(poolWith(query), { send: jest.fn() } as never, {} as never);
    await svc.triggerManually('tenant_x', 'Acme');
    const select = query.mock.calls.map((c) => String(c[0])).find((sql) => /FROM installments i/.test(sql))!;
    expect(select).toMatch(/l\.status IN \('APPROVED','DISBURSED'\)/);
  });
});
