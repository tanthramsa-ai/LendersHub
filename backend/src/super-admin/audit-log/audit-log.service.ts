import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditActor {
  id: string;
  email: string;
}

export interface RecordAuditEntryInput {
  actor: AuditActor | null;
  ipAddress: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetLabel?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Write one audit entry. Never throws — a logging failure must not break
   * the action being audited (matches the existing welcome-email /
   * Vercel-domain "best effort" pattern used elsewhere in tenant provisioning).
   */
  async record(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actor?.id ?? null,
          actorEmail: input.actor?.email ?? 'system',
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          targetLabel: input.targetLabel ?? null,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: input.ipAddress,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to record audit entry "${input.action}": ${(err as Error)?.message}`);
    }
  }

  async list(params: {
    page?: number;
    limit?: number;
    action?: string;
    targetType?: string;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};
    if (params.action) where.action = params.action;
    if (params.targetType) where.targetType = params.targetType;
    if (params.search) {
      where.OR = [
        { actorEmail: { contains: params.search, mode: 'insensitive' } },
        { targetLabel: { contains: params.search, mode: 'insensitive' } },
        { action: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [total, entries, actions] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      // Distinct action list for the filter dropdown — cheap, bounded cardinality.
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
    ]);

    return {
      total,
      page,
      limit,
      data: entries,
      availableActions: actions.map((a) => a.action),
    };
  }
}
