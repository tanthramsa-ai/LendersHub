import { TenantActivityLogService } from './tenant-activity-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

function makeUser(overrides: Partial<TenantJwtPayload> = {}): TenantJwtPayload {
  return {
    sub: 'u1',
    email: 'owner@acme.test',
    firstName: 'Ann',
    lastName: 'Owner',
    role: 'OWNER',
    tenantId: 't1',
    subdomain: 'acme',
    schemaName: 'tenant_acme',
    type: 'tenant_user',
    ...overrides,
  };
}

describe('TenantActivityLogService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let svc: TenantActivityLogService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    svc = new TenantActivityLogService(prisma);
  });

  describe('record', () => {
    it('ensures the table exists (once) then inserts with actor/action/target', async () => {
      const user = makeUser();
      await svc.record(client as any, user, {
        action: 'loan.created',
        entityType: 'loan',
        entityId: 'l1',
        entityLabel: 'LN2026000001',
        metadata: { principal: 5000 },
      });

      // CREATE TABLE, CREATE INDEX, INSERT
      expect(query).toHaveBeenCalledTimes(3);
      expect(query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS "tenant_acme"."activity_log"');
      expect(query.mock.calls[2][0]).toContain('INSERT INTO activity_log');
      const insertParams = query.mock.calls[2][1];
      expect(insertParams).toEqual([
        'loan.created', 'loan', 'l1', 'LN2026000001',
        'u1', 'Ann Owner', 'OWNER', JSON.stringify({ principal: 5000 }),
      ]);
    });

    it('skips CREATE TABLE/INDEX on the second call for the same schema (cached)', async () => {
      const user = makeUser();
      await svc.record(client as any, user, { action: 'a', entityType: 't' });
      query.mockClear();
      await svc.record(client as any, user, { action: 'b', entityType: 't' });

      expect(query).toHaveBeenCalledTimes(1); // just the INSERT
      expect(query.mock.calls[0][0]).toContain('INSERT INTO activity_log');
    });

    it('falls back to email when first/last name are empty', async () => {
      const user = makeUser({ firstName: '', lastName: '' });
      await svc.record(client as any, user, { action: 'a', entityType: 't' });

      const insertParams = query.mock.calls[2][1];
      expect(insertParams[5]).toBe('owner@acme.test');
    });

    it('never throws — a logging failure must not block the audited action', async () => {
      query.mockRejectedValue(new Error('db down'));
      await expect(
        svc.record(client as any, makeUser(), { action: 'a', entityType: 't' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('opens its own schema-scoped connection and applies filters', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })                          // SET search_path (withSchema)
        .mockResolvedValueOnce({ rows: [] })                          // ensure CREATE TABLE
        .mockResolvedValueOnce({ rows: [] })                          // ensure CREATE INDEX
        .mockResolvedValueOnce({ rows: [{ id: '1' }] })               // data
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })            // count
        .mockResolvedValueOnce({ rows: [{ action: 'loan.created' }] }); // distinct actions

      const result = await svc.list(makeUser(), 1, 25, { action: 'loan.created', search: 'acme' });

      expect(poolConnect).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toContain('SET search_path');
      expect(result.total).toBe(1);
      expect(result.availableActions).toEqual(['loan.created']);

      const dataCall = query.mock.calls[3][0];
      const countCall = query.mock.calls[4][0];
      expect(dataCall).toContain('action = $1');
      expect(countCall).toContain('action = $1');
    });
  });
});
