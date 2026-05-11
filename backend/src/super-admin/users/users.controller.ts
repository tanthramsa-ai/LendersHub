import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminJwtGuard } from '../guards/super-admin-jwt.guard';
import { UsersService } from './users.service';

@UseGuards(SuperAdminJwtGuard)
@Controller('api/v1/super-admin/users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  listSuperAdmins() {
    return this.users.listSuperAdmins();
  }

  @Get('audit-log')
  auditLog(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('email') email?: string,
  ) {
    return this.users.getLoginAuditLog({
      page: Math.max(1, parseInt(page)),
      limit: Math.min(100, Math.max(1, parseInt(limit))),
      email,
    });
  }
}
