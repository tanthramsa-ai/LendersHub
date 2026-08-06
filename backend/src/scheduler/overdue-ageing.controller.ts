import { Controller, Post, UseGuards } from '@nestjs/common';
import { SuperAdminJwtGuard } from '../super-admin/guards/super-admin-jwt.guard';
import { OverdueAgeingService } from './overdue-ageing.service';

@UseGuards(SuperAdminJwtGuard)
@Controller('api/v1/super-admin/ops')
export class OverdueAgeingController {
  constructor(private ageing: OverdueAgeingService) {}

  /** Runs the ageing pass immediately instead of waiting for the daily cron. */
  @Post('age-overdue')
  async ageOverdue() {
    const results = await this.ageing.runAll();
    return {
      tenants: results.length,
      aged: results.reduce((n, r) => n + r.aged, 0),
      restored: results.reduce((n, r) => n + r.restored, 0),
      results,
    };
  }
}
