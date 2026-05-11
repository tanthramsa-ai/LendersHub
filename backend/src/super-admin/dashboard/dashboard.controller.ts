import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { SuperAdminJwtGuard } from '../guards/super-admin-jwt.guard';

@UseGuards(SuperAdminJwtGuard)
@Controller('api/v1/super-admin/dashboard')
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboard.getOverview();
  }

  @Get('tenants')
  tenants() {
    return this.dashboard.getTenantDetail();
  }

  @Get('mrr')
  mrr() {
    return this.dashboard.getMrrDetail();
  }

  @Get('active-users')
  activeUsers() {
    return this.dashboard.getActiveUsersDetail();
  }

  @Get('alerts')
  alerts() {
    return this.dashboard.getAlertsDetail();
  }
}
