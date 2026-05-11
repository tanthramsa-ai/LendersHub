import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SystemHealthService {
  constructor(private prisma: PrismaService) {}

  async getHealth() {
    const now = Date.now();
    const oneDayAgo = new Date(now - 86_400_000);
    const oneHourAgo = new Date(now - 3_600_000);

    // DB round-trip
    const dbStart = Date.now();
    const [
      tenantsByStatus,
      failedLogins24h,
      failedLoginsLastHour,
      totalLogins24h,
      recentFailedLogins,
      failedTenants,
    ] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.loginAuditLog.count({ where: { success: false, createdAt: { gte: oneDayAgo } } }),
      this.prisma.loginAuditLog.count({ where: { success: false, createdAt: { gte: oneHourAgo } } }),
      this.prisma.loginAuditLog.count({ where: { createdAt: { gte: oneDayAgo } } }),
      this.prisma.loginAuditLog.findMany({
        where: { success: false, createdAt: { gte: oneDayAgo } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { email: true, ipAddress: true, reason: true, createdAt: true },
      }),
      this.prisma.tenant.findMany({
        where: { status: { in: ['FAILED', 'PROVISIONING'] } },
        select: { id: true, companyName: true, subdomain: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const dbLatencyMs = Date.now() - dbStart;

    const statusMap = Object.fromEntries(
      tenantsByStatus.map((r) => [r.status, r._count._all]),
    );

    const loginSuccessRate =
      totalLogins24h > 0
        ? Math.round(((totalLogins24h - failedLogins24h) / totalLogins24h) * 1000) / 10
        : 100;

    return {
      checkedAt: new Date().toISOString(),
      database: {
        status: 'healthy',
        latencyMs: dbLatencyMs,
      },
      tenants: {
        active: statusMap['ACTIVE'] ?? 0,
        provisioning: statusMap['PROVISIONING'] ?? 0,
        suspended: statusMap['SUSPENDED'] ?? 0,
        failed: statusMap['FAILED'] ?? 0,
        total: Object.values(statusMap).reduce((s, v) => s + v, 0),
      },
      security: {
        failedLogins24h,
        failedLoginsLastHour,
        loginSuccessRate,
        riskLevel:
          failedLoginsLastHour >= 10 ? 'high'
          : failedLoginsLastHour >= 3 ? 'medium'
          : failedLogins24h >= 20 ? 'low'
          : 'none',
      },
      recentFailedLogins,
      failedTenants,
    };
  }
}
