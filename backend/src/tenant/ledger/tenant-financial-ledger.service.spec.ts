import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantFinancialLedgerService, StatementScope } from './tenant-financial-ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { TenantLedgerPostingService } from './tenant-ledger-posting.service';

const user = (role: string, sub = 'u1'): TenantJwtPayload => ({
  sub, email: `${role}@acme.test`, firstName: 'Ann', lastName: role, role, tenantId: 't1',
  subdomain: 'acme', schemaName: 'tenant_acme', type: 'tenant_user',
});
const today = () => new Date().toISOString().slice(0, 10);
const ymd = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const UUID = '11111111-1111-4111-8111-111111111111';

describe('TenantFinancialLedgerService', () => {
  let query: jest.Mock;
  let svc: TenantFinancialLedgerService;
  let activity: { record: jest.Mock };

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (/INSERT INTO fund_transactions/.test(sql)) return { rows: [{ id: `id-${query.mock.calls.length}` }] };
      if (/COUNT\(\*\) FILTER/.test(sql)) return { rows: [{ opening: '0', closing: '0', credit: '0', debit: '0', n: '0' }] };
      return { rows: [] };
    });
    activity = { record: jest.fn().mockResolvedValue(undefined) };
    svc = new TenantFinancialLedgerService(
      { pool: { connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }) } } as unknown as PrismaService,
      { ensureTable: jest.fn().mockResolvedValue(undefined) } as unknown as TenantLedgerPostingService,
      { getTotalCapitalWithClient: jest.fn().mockResolvedValue(0) } as unknown as TenantFundersService,
      activity as unknown as TenantActivityLogService,
    );
  });

  describe('who sees what', () => {
    it.each([['OWNER', 'full'], ['ADMIN', 'full'], ['MANAGER', 'manager'], ['AGENT', 'agent']])('%s gets %s scope', (role, level) => {
      expect(svc.scopeFor(user(role)).level).toBe(level);
    });

    it.each(['STAFF', 'CUSTOMER'])('%s has no ledger access', (role) => {
      expect(() => svc.scopeFor(user(role))).toThrow(ForbiddenException);
    });

    const sqlFor = async (u: TenantJwtPayload) => {
      await svc.transactions(u, { limit: 10 });
      const call = query.mock.calls.find((c) => /ranked AS/.test(String(c[0])))!;
      return { sql: String(call[0]), params: call[1] as unknown[] };
    };

    it('owner/admin: no row restriction, and a running balance is computed', async () => {
      const { sql } = await sqlFor(user('OWNER'));
      expect(sql).not.toMatch(/WHERE r\.source/);
      expect(sql).toMatch(/SUM\(s\.amount \* s\.dir\) OVER \(ORDER BY s\.txn_date, s\.created_at, s\.id\)/);
    });

    it("manager: loan money plus only the manual entries they recorded themselves", async () => {
      const { sql, params } = await sqlFor(user('MANAGER', UUID));
      expect(sql).toMatch(/WHERE \(r\.source = 'LEDGER' OR r\.created_by = \$\d+::uuid\)/);
      expect(params).toContain(UUID);
      expect(sql).not.toContain(UUID);
    });

    it("agent: only collection rows, and only the caller's own, bound as a parameter", async () => {
      const { sql, params } = await sqlFor(user('AGENT', UUID));
      expect(sql).toMatch(/r\.kind IN \('COLLECTION_PRINCIPAL','COLLECTION_INTEREST','COLLECTION_OTHER'\)/);
      expect(sql).toMatch(/r\.agent_id = \$\d+::uuid/);
      expect(params).toContain(UUID);
      expect(sql).not.toContain(UUID); // never spliced into the SQL text
    });

    it('hides balances from non-owners', async () => {
      const res = await svc.transactions(user('MANAGER'), {});
      expect(res.openingBalance).toBeNull();
      expect(res.closingBalance).toBeNull();
    });
  });

  describe('filters', () => {
    const full: StatementScope = { level: 'full', userId: 'u1' };
    const agent: StatementScope = { level: 'agent', userId: 'u1' };

    it('parses type, group, mode, ids and search', () => {
      const f = svc.parseFilters({ kind: 'CASH_IN,BANK_IN', mode: 'Cash', loanId: UUID, q: ' abc ' }, full);
      expect(f).toMatchObject({ kinds: ['CASH_IN', 'BANK_IN'], mode: 'Cash', loanId: UUID, q: 'abc' });
    });

    it('a group and a kind narrow each other (intersection)', () => {
      expect(svc.parseFilters({ group: 'principal', kind: 'DISBURSEMENT,CASH_IN' }, full).kinds).toEqual(['DISBURSEMENT']);
    });

    it.each([
      ['an unknown type', { kind: 'NOPE' }], ['an unknown group', { group: 'nope' }], ['an unknown mode', { mode: 'Crypto' }],
      ['a malformed loan id', { loanId: '123' }], ['a malformed agent id', { agentId: 'abc' }], ['over-long search text', { q: 'x'.repeat(101) }],
    ])('rejects %s', (_l, raw) => {
      expect(() => svc.parseFilters(raw, full)).toThrow(BadRequestException);
    });

    it('an agent cannot widen their scope by naming another agent', () => {
      expect(svc.parseFilters({ agentId: UUID }, agent).agentId).toBeUndefined();
      expect(svc.parseFilters({ agentId: UUID }, full).agentId).toBe(UUID);
    });

    it('search text is bound as a parameter with LIKE wildcards escaped', async () => {
      await svc.transactions(user('OWNER'), { q: "50%_'; DROP TABLE users;--" });
      const call = query.mock.calls.find((c) => /ranked AS/.test(String(c[0])))!;
      expect(String(call[0])).not.toContain('DROP TABLE');
      expect(call[1]).toContain("%50\\%\\_'; DROP TABLE users;--%");
    });

    it.each([['page 0', { page: 0 }], ['limit 0', { limit: 0 }], ['limit 201', { limit: 201 }], ['fractional page', { page: 1.5 }], ['text limit', { limit: 'abc' }]])(
      'rejects %s', async (_l, q) => {
        await expect(svc.transactions(user('OWNER'), q)).rejects.toThrow(BadRequestException);
      });
  });

  describe('manual entries', () => {
    const entry = (over: Record<string, unknown> = {}) => ({ date: today(), type: 'CASH_IN' as const, amount: 500, ...over }) as never;
    const inserts = () => query.mock.calls.filter((c) => /INSERT INTO fund_transactions/.test(String(c[0])));

    it.each(['AGENT', 'STAFF', 'CUSTOMER'])('%s cannot record entries', async (role) => {
      await expect(svc.createEntry(user(role), entry())).rejects.toThrow(ForbiddenException);
      expect(query).not.toHaveBeenCalled();
    });

    it.each(['OWNER', 'ADMIN', 'MANAGER'])('%s can', async (role) => {
      await expect(svc.createEntry(user(role), entry())).resolves.toMatchObject({ type: 'CASH_IN', amount: 500 });
    });

    it('a cash deposit is one CREDIT on the CASH account', async () => {
      await svc.createEntry(user('OWNER'), entry());
      expect(inserts()).toHaveLength(1);
      const p = inserts()[0][1] as unknown[];
      expect(p.slice(1, 5)).toEqual(['CREDIT', 500, 'CASH_IN', 'CASH']);
    });

    it('a bank withdrawal is a DEBIT on the named account', async () => {
      await svc.createEntry(user('OWNER'), entry({ type: 'BANK_OUT', accountName: ' HDFC ' }));
      expect((inserts()[0][1] as unknown[]).slice(1, 5)).toEqual(['DEBIT', 500, 'BANK_OUT', 'HDFC']);
    });

    it('a transfer is two linked rows (debit from, credit to) in one transaction', async () => {
      const res = await svc.createEntry(user('OWNER'), entry({ type: 'TRANSFER', fromAccount: 'CASH', toAccount: 'HDFC' }));
      const [a, b] = inserts().map((c) => c[1] as unknown[]);
      expect([a[1], a[4]]).toEqual(['DEBIT', 'CASH']);
      expect([b[1], b[4]]).toEqual(['CREDIT', 'HDFC']);
      expect(a[5]).toBe('transfer');
      expect(a[6]).toBe(b[6]);          // same group id
      expect(res.groupId).toBe(a[6]);
      const sqls = query.mock.calls.map((c) => String(c[0]));
      expect(sqls).toContain('BEGIN');
      expect(sqls).toContain('COMMIT');
    });

    it('rolls back both legs if the second fails', async () => {
      let n = 0;
      query.mockImplementation(async (sql: string) => {
        if (/INSERT INTO fund_transactions/.test(sql) && ++n === 2) throw new Error('db down');
        return { rows: [{ id: 'x' }] };
      });
      await expect(svc.createEntry(user('OWNER'), entry({ type: 'TRANSFER', fromAccount: 'CASH', toAccount: 'HDFC' }))).rejects.toThrow('db down');
      const sqls = query.mock.calls.map((c) => String(c[0]));
      expect(sqls).toContain('ROLLBACK');
      expect(sqls).not.toContain('COMMIT');
    });

    it('logs who recorded it', async () => {
      await svc.createEntry(user('MANAGER'), entry());
      expect(activity.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sub: 'u1' }), expect.objectContaining({ action: 'ledger.entry_created' }));
    });

    it.each([
      ['a future date', { date: ymd(5) }], ['an impossible date', { date: '2026-02-31' }], ['an ancient date', { date: '1999-01-01' }],
      ['amount "abc"', { amount: 'abc' }], ['amount 0', { amount: 0 }], ['a negative amount', { amount: -5 }], ['amount NaN', { amount: NaN }],
      ['an unknown type', { type: 'GIFT' }], ['a missing type', { type: undefined }],
      ['CASH as a bank account', { type: 'BANK_IN', accountName: 'cash' }],
      ['an over-long account', { type: 'BANK_IN', accountName: 'a'.repeat(61) }],
      ['an adjustment without a reason', { type: 'ADJUSTMENT', direction: 'IN', remarks: '  ' }],
      ['an adjustment without a direction', { type: 'ADJUSTMENT', remarks: 'fix' }],
      ['a transfer to the same account', { type: 'TRANSFER', fromAccount: 'hdfc', toAccount: 'HDFC' }],
      ['over-long remarks', { remarks: 'r'.repeat(501) }], ['over-long reference', { referenceNo: 'r'.repeat(101) }],
      ['non-text remarks', { remarks: 42 }],
    ])('rejects %s before touching the database', async (_l, over) => {
      await expect(svc.createEntry(user('OWNER'), entry(over))).rejects.toThrow(BadRequestException);
      expect(query).not.toHaveBeenCalled();
    });

    it('tomorrow is allowed (a day of grace for the UTC/IST gap)', async () => {
      await expect(svc.createEntry(user('OWNER'), entry({ date: ymd(1) }))).resolves.toBeDefined();
    });
  });

  describe('deleting entries', () => {
    it.each(['MANAGER', 'AGENT'])('%s cannot delete', async (role) => {
      await expect(svc.deleteEntry(user(role), UUID)).rejects.toThrow(ForbiddenException);
    });

    it('is a soft delete (UPDATE, never DELETE)', async () => {
      query.mockImplementation(async (sql: string) => {
        if (/SELECT id, category/.test(sql)) return { rows: [{ id: UUID, category: 'CASH_IN', amount: '5', entity_type: null, entity_id: null }] };
        if (/UPDATE fund_transactions/.test(sql)) return { rows: [{ id: UUID }] };
        return { rows: [] };
      });
      await expect(svc.deleteEntry(user('OWNER'), `ft:${UUID}`, 'typo')).resolves.toEqual({ deleted: 1 });
      const sqls = query.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((s) => /UPDATE fund_transactions SET deleted_at/.test(s))).toBe(true);
      expect(sqls.some((s) => /DELETE FROM/i.test(s))).toBe(false);
    });

    it('a malformed id is a 400', async () => {
      await expect(svc.deleteEntry(user('OWNER'), 'not-an-id')).rejects.toThrow(BadRequestException);
    });
  });

  describe('summary', () => {
    it('hides capital, cash and bank from a manager, and loan figures from an agent', async () => {
      query.mockImplementation(async (sql: string) => {
        if (/to_char\(txn_date, 'YYYY-MM'\)/.test(sql)) return { rows: [] };
        if (/MIN\(txn_date\)/.test(sql)) return { rows: [{ lent: '0', cash: '5', bank: '6', ledger_movement: '0', first_date: null }] };
        return { rows: [{ outstanding: '0' }] };
      });
      const m = (await svc.summary(user('MANAGER'), {})).cards;
      expect([m.totalCapital, m.fundAvailable, m.cashInHand, m.bankBalance]).toEqual([null, null, null, null]);
      expect(m.totalLent).not.toBeNull();
      const a = (await svc.summary(user('AGENT'), {})).cards;
      expect([a.totalLent, a.outstandingPrincipal, a.outstandingInterest, a.cashInHand]).toEqual([null, null, null, null]);
      const o = (await svc.summary(user('OWNER'), {})).cards;
      expect([o.cashInHand, o.bankBalance]).toEqual([5, 6]);
    });
  });

  describe('breakdown', () => {
    it('refuses the cash/bank breakdown to managers and agents', async () => {
      await expect(svc.breakdown(user('MANAGER'), { dimension: 'mode' })).rejects.toThrow(ForbiddenException);
      await expect(svc.breakdown(user('AGENT'), { dimension: 'mode' })).rejects.toThrow(ForbiddenException);
    });
    it('rejects an unknown dimension', async () => {
      await expect(svc.breakdown(user('OWNER'), { dimension: 'planet' })).rejects.toThrow(BadRequestException);
    });
  });
});

describe('tidyRemarks', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tidyRemarks } = require('./tenant-financial-ledger.service');
  it('shortens ids embedded in posted remarks', () => {
    expect(tidyRemarks('Collection for installment 4b5cc5ce-708c-4d69-9724-fef491669004')).toBe('Collection for installment 4b5cc5ce');
    expect(tidyRemarks('a 11111111-1111-4111-8111-111111111111 b 22222222-2222-4222-8222-222222222222')).toBe('a 11111111 b 22222222');
  });
  it('leaves ordinary text, empty and null alone', () => {
    expect(tidyRemarks('Office payment')).toBe('Office payment');
    expect(tidyRemarks('')).toBe('');
    expect(tidyRemarks(null)).toBeNull();
  });
});
