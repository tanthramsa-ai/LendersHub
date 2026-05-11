import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const now = new Date();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      tenantsNow,
      tenantsLastMonth,
      mrrTenantsNow,
      mrrTenantsLast,
      activeUsersNow,
      activeUsersLastMonth,
      alertsNow,
      alertsLastMonth,
    ] = await Promise.all([
      // Total Tenants: active Tenant records
      this.prisma.tenant.count({ where: { status: 'ACTIVE', createdAt: { lte: now } } }),
      // Tenants as of end of last month
      this.prisma.tenant.count({ where: { status: 'ACTIVE', createdAt: { lte: endOfLastMonth } } }),

      // MRR: sum of monthlyAmount for ACTIVE tenants with a subscription
      this.prisma.tenant.findMany({
        where: { status: 'ACTIVE', plan: { not: null } },
        select: { monthlyAmount: true },
      }),
      // MRR last month: subscriptions that started before end of last month
      this.prisma.tenant.findMany({
        where: { status: 'ACTIVE', plan: { not: null }, subscriptionStartsAt: { lte: endOfLastMonth } },
        select: { monthlyAmount: true },
      }),

      // Active Users: distinct users with successful login in last 30 days
      this.prisma.loginAuditLog.groupBy({
        by: ['userId'],
        where: { success: true, userId: { not: null }, createdAt: { gte: thirtyDaysAgo } },
      }),
      // Active Users last period: 30–60 days ago
      this.prisma.loginAuditLog.groupBy({
        by: ['userId'],
        where: { success: true, userId: { not: null }, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),

      // System Alerts: failed logins in last 24 hours
      this.prisma.loginAuditLog.count({ where: { success: false, createdAt: { gte: oneDayAgo } } }),
      // Alerts last period: 24–48 hours ago
      this.prisma.loginAuditLog.count({
        where: {
          success: false,
          createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000), lt: oneDayAgo },
        },
      }),
    ]);

    const mrrNow = mrrTenantsNow.reduce((sum, t) => sum + Number(t.monthlyAmount ?? 0), 0);
    const mrrLast = mrrTenantsLast.reduce((sum, t) => sum + Number(t.monthlyAmount ?? 0), 0);

    return {
      tenants: {
        value: tenantsNow,
        growth: this.growth(tenantsLastMonth, tenantsNow),
      },
      mrr: {
        value: Math.round(mrrNow * 100) / 100,
        growth: this.growth(mrrLast, mrrNow),
      },
      activeUsers: {
        value: activeUsersNow.length,
        growth: this.growth(activeUsersLastMonth.length, activeUsersNow.length),
      },
      systemAlerts: {
        value: alertsNow,
        growth: this.growth(alertsLastMonth, alertsNow),
        severity: alertsNow === 0 ? 'none' : alertsNow < 5 ? 'low' : alertsNow < 20 ? 'medium' : 'high',
      },
      updatedAt: now.toISOString(),
    };
  }

  async getTenantDetail() {
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const count = await this.prisma.tenant.count({ where: { createdAt: { gte: start, lte: end } } });
      months.push({ month: start.toLocaleString('default', { month: 'short', year: '2-digit' }), count });
    }

    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        companyName: true,
        subdomain: true,
        adminEmail: true,
        status: true,
        createdAt: true,
        _count: { select: { users: true, loans: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { monthlyCounts: months, tenants };
  }

  async getMrrDetail() {
    const now = new Date();
    const months: { month: string; mrr: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE', plan: { not: null }, subscriptionStartsAt: { lte: end } },
        select: { monthlyAmount: true },
      });
      const mrr = tenants.reduce((sum, t) => sum + Number(t.monthlyAmount ?? 0), 0);
      months.push({
        month: start.toLocaleString('default', { month: 'short', year: '2-digit' }),
        mrr: Math.round(mrr * 100) / 100,
      });
    }

    const topTenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', plan: { not: null } },
      select: {
        id: true,
        companyName: true,
        subdomain: true,
        plan: true,
        billingCycle: true,
        monthlyAmount: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true,
      },
      orderBy: { monthlyAmount: 'desc' },
      take: 20,
    });

    return {
      monthlyMrr: months,
      topTenants: topTenants.map((t) => ({
        ...t,
        monthlyAmount: Number(t.monthlyAmount ?? 0),
      })),
    };
  }

  async getActiveUsersDetail() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentLogins = await this.prisma.loginAuditLog.findMany({
      where: { success: true, userId: { not: null }, createdAt: { gte: thirtyDaysAgo } },
      select: { userId: true, createdAt: true, ipAddress: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Deduplicate to get latest login per user
    const seen = new Set<string>();
    const uniqueLogins = recentLogins.filter((l) => {
      if (seen.has(l.userId!)) return false;
      seen.add(l.userId!);
      return true;
    });

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueLogins.map((l) => l.userId!) } },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    const daily: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      const count = await this.prisma.loginAuditLog.count({
        where: { success: true, createdAt: { gte: dayStart, lte: dayEnd } },
      });
      daily.push({ day: dayStart.toLocaleDateString('default', { weekday: 'short', day: 'numeric' }), count });
    }

    return {
      dailyLogins: daily,
      recentUsers: uniqueLogins.slice(0, 50).map((l) => ({
        ...userMap.get(l.userId!),
        lastLoginAt: l.createdAt,
        ipAddress: l.ipAddress,
      })),
    };
  }

  async getAlertsDetail() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const alerts = await this.prisma.loginAuditLog.findMany({
      where: { success: false, createdAt: { gte: oneDayAgo } },
      select: { id: true, email: true, ipAddress: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Group by IP to find brute-force candidates
    const byIp = alerts.reduce<Record<string, number>>((acc, a) => {
      acc[a.ipAddress] = (acc[a.ipAddress] ?? 0) + 1;
      return acc;
    }, {});

    const suspiciousIps = Object.entries(byIp)
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .map(([ip, count]) => ({ ip, failedAttempts: count }));

    return { alerts, suspiciousIps };
  }

  private growth(prev: number, curr: number): number {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100 * 10) / 10;
  }
}
