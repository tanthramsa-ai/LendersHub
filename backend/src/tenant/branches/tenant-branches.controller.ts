import { Controller, Get, Post, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { TenantBranchesService, CreateBranchDto, UpdateBranchDto } from './tenant-branches.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/branches')
@UseGuards(TenantJwtGuard)
export class TenantBranchesController {
  constructor(private svc: TenantBranchesService) {}

  @Get()
  list(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.list(req.user);
  }

  @Get(':id/members')
  getMembers(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.getMembers(req.user, id);
  }

  @Post()
  create(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateBranchDto) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  update(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.svc.update(req.user, id, dto);
  }
}
