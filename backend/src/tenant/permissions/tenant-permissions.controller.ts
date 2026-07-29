import { Controller, Get, Put, Post, Body, UseGuards, Request } from '@nestjs/common';
import { TenantPermissionsService, PermissionUpdate } from './tenant-permissions.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/permissions')
@UseGuards(TenantJwtGuard)
export class TenantPermissionsController {
  constructor(private svc: TenantPermissionsService) {}

  @Get()
  getMatrix(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.getMatrix(req.user);
  }

  @Put()
  updateMatrix(
    @Request() req: { user: TenantJwtPayload },
    @Body() body: { updates: PermissionUpdate[] },
  ) {
    return this.svc.updateMatrix(req.user, body.updates);
  }

  @Post('roles')
  addRole(@Request() req: { user: TenantJwtPayload }, @Body() body: { roleKey: string }) {
    return this.svc.addRole(req.user, body.roleKey);
  }
}
