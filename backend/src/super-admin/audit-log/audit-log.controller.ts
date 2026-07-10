import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminJwtGuard } from '../guards/super-admin-jwt.guard';
import { AuditLogService } from './audit-log.service';

@UseGuards(SuperAdminJwtGuard)
@Controller('api/v1/super-admin/audit-log')
export class AuditLogController {
  constructor(private auditLog: AuditLogService) {}

  @Get()
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('search') search?: string,
  ) {
    return this.auditLog.list({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      action: action || undefined,
      targetType: targetType || undefined,
      search: search || undefined,
    });
  }
}
