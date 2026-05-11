import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminJwtGuard } from '../guards/super-admin-jwt.guard';
import { SystemHealthService } from './system-health.service';

@UseGuards(SuperAdminJwtGuard)
@Controller('api/v1/super-admin/system-health')
export class SystemHealthController {
  constructor(private health: SystemHealthService) {}

  @Get()
  get() {
    return this.health.getHealth();
  }
}
