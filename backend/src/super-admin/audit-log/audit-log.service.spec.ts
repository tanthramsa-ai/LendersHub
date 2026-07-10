import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditLogService', () => {
  let create: jest.Mock;
  let count: jest.Mock;
  let findMany: jest.Mock;
  let prisma: PrismaService;
  let svc: AuditLogService;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    count = jest.fn().mockResolvedValue(0);
    findMany = jest.fn().mockResolvedValue([]);
    prisma = { auditLog: { create, count, findMany } } as unknown as PrismaService;
    svc = new AuditLogService(prisma);
  });

  describe('record', () => {
    it('writes an entry with the actor, action, target, and ip', async () => {
      await svc.record({
        actor: { id: 'u1', email: 'admin@lendershub.in' },
        ipAddress: '1.2.3.4',
        action: 'tenant.created',
        targetType: 'tenant',
        targetId: 't1',
        targetLabel: 'Acme Corp',
        metadata: { plan: 'STARTER' },
      });

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].data).toEqual({
        actorId: 'u1',
        actorEmail: 'admin@lendershub.in',
        action: 'tenant.created',
        targetType: 'tenant',
        targetId: 't1',
        targetLabel: 'Acme Corp',
        metadata: { plan: 'STARTER' },
        ipAddress: '1.2.3.4',
      });
    });

    it('falls back to actorId null and actorEmail "system" when actor is null', async () => {
      await svc.record({
        actor: null,
        ipAddress: '1.2.3.4',
        action: 'tenant.created',
        targetType: 'tenant',
      });

      expect(create.mock.calls[0][0].data.actorId).toBeNull();
      expect(create.mock.calls[0][0].data.actorEmail).toBe('system');
    });

    it('never throws — a logging failure must not break the audited action', async () => {
      create.mockRejectedValue(new Error('db down'));

      await expect(
        svc.record({ actor: null, ipAddress: '1.2.3.4', action: 'x', targetType: 'y' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('clamps limit to 100 and page to a minimum of 1', async () => {
      await svc.list({ page: 0, limit: 500 });

      expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
    });

    it('filters by action, targetType, and search across actor/target/action', async () => {
      await svc.list({ action: 'tenant.created', targetType: 'tenant', search: 'acme' });

      const where = findMany.mock.calls[0][0].where;
      expect(where.action).toBe('tenant.created');
      expect(where.targetType).toBe('tenant');
      expect(where.OR).toEqual([
        { actorEmail: { contains: 'acme', mode: 'insensitive' } },
        { targetLabel: { contains: 'acme', mode: 'insensitive' } },
        { action: { contains: 'acme', mode: 'insensitive' } },
      ]);
    });

    it('returns the distinct action list for the filter dropdown', async () => {
      findMany
        .mockResolvedValueOnce([{ id: '1' }]) // main page query
        .mockResolvedValueOnce([{ action: 'tenant.created' }, { action: 'branch.created' }]); // distinct actions

      const result = await svc.list({});

      expect(result.availableActions).toEqual(['tenant.created', 'branch.created']);
    });
  });
});
