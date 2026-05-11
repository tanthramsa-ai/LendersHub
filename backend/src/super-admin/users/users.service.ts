import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async listSuperAdmins() {
    const users = await this.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        totpEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return { total: users.length, users };
  }

  async getLoginAuditLog(params: { page: number; limit: number; email?: string }) {
    const { page, limit, email } = params;
    const where = email ? { email: { contains: email, mode: 'insensitive' as const } } : {};
    const [total, logs] = await Promise.all([
      this.prisma.loginAuditLog.count({ where }),
      this.prisma.loginAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          ipAddress: true,
          success: true,
          reason: true,
          createdAt: true,
        },
      }),
    ]);
    return { total, page, limit, logs };
  }
}
