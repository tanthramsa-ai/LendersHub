import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req,
  UseGuards, HttpCode, HttpStatus, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ConfigureSubscriptionDto } from './dto/configure-subscription.dto';
import { SuperAdminJwtGuard } from '../guards/super-admin-jwt.guard';
import type { AuditActor } from '../audit-log/audit-log.service';

@UseGuards(SuperAdminJwtGuard)
@Controller('api/v1/super-admin/tenants')
export class TenantController {
  constructor(private tenants: TenantService) {}

  private actorFrom(req: any): AuditActor {
    return { id: req.user.id, email: req.user.email };
  }

  private ipFrom(req: any): string {
    return req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
  }

  @Get('check-subdomain')
  checkSubdomain(@Query('subdomain') subdomain: string) {
    return this.tenants.checkSubdomain(subdomain ?? '');
  }

  @Get('plans')
  getPlans() {
    return this.tenants.getPlans();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTenantDto, @Req() req: any) {
    return this.tenants.create(dto, this.actorFrom(req), this.ipFrom(req));
  }

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('plan') plan?: string,
    @Query('status') status?: string,
    @Query('subscriptionStatus') subscriptionStatus?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.tenants.list(page, Math.min(limit, 100), {
      search: search || undefined,
      plan: plan || undefined,
      status: status || undefined,
      subscriptionStatus: subscriptionStatus || undefined,
      sortBy: sortBy || undefined,
      sortDir: sortDir === 'asc' ? 'asc' : 'desc',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenants.findOne(id);
  }

  @Put(':id/subscription')
  configureSubscription(@Param('id') id: string, @Body() dto: ConfigureSubscriptionDto, @Req() req: any) {
    return this.tenants.configureSubscription(id, dto, this.actorFrom(req), this.ipFrom(req));
  }

  // ── Lifecycle: suspend / reactivate / delete ────────────────────────────────

  @Patch(':id/suspend')
  suspend(@Param('id') id: string, @Req() req: any) {
    return this.tenants.suspend(id, this.actorFrom(req), this.ipFrom(req));
  }

  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string, @Req() req: any) {
    return this.tenants.reactivate(id, this.actorFrom(req), this.ipFrom(req));
  }

  @Delete(':id')
  softDelete(@Param('id') id: string, @Body() dto: { confirmSubdomain: string }, @Req() req: any) {
    return this.tenants.softDelete(id, dto.confirmSubdomain ?? '', this.actorFrom(req), this.ipFrom(req));
  }

  // ── Tenant user endpoints (super-admin bootstrap) ───────────────────────────

  @Get(':id/users')
  listTenantUsers(@Param('id') id: string) {
    return this.tenants.listTenantUsers(id);
  }

  @Post(':id/users')
  @HttpCode(HttpStatus.CREATED)
  createTenantUser(@Param('id') id: string, @Body() dto: {
    email: string; password: string;
    firstName: string; lastName: string;
    phone?: string; role: string;
  }, @Req() req: any) {
    return this.tenants.createTenantUser(id, dto, this.actorFrom(req), this.ipFrom(req));
  }

  @Patch(':id/users/:userId/reset-password')
  resetTenantUserPassword(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: { password?: string },
    @Req() req: any,
  ) {
    return this.tenants.resetTenantUserPassword(id, userId, dto?.password ?? '', this.actorFrom(req), this.ipFrom(req));
  }

  // ── Branch endpoints ────────────────────────────────────────────────────────

  @Get(':id/branches')
  listBranches(@Param('id') id: string) {
    return this.tenants.listBranches(id);
  }

  @Post(':id/branches')
  @HttpCode(HttpStatus.CREATED)
  createBranch(@Param('id') id: string, @Body() dto: {
    name: string; code: string;
    address?: string; city?: string; state?: string;
    phone?: string; email?: string; managerName?: string;
  }, @Req() req: any) {
    return this.tenants.createBranch(id, dto, this.actorFrom(req), this.ipFrom(req));
  }

  @Get(':id/branches/:branchId')
  getBranch(@Param('id') id: string, @Param('branchId') branchId: string) {
    return this.tenants.getBranch(id, branchId);
  }

  @Patch(':id/branches/:branchId')
  updateBranch(
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() dto: { name?: string; address?: string; city?: string; state?: string; phone?: string; email?: string; managerName?: string; isActive?: boolean },
    @Req() req: any,
  ) {
    return this.tenants.updateBranch(id, branchId, dto, this.actorFrom(req), this.ipFrom(req));
  }

  @Post(':id/loan-types')
  @HttpCode(HttpStatus.CREATED)
  createLoanType(@Param('id') id: string, @Body() dto: {
    name: string; description?: string;
    minAmount?: number; maxAmount?: number;
    minInterestRate?: number; maxInterestRate?: number;
    minTermMonths?: number; maxTermMonths?: number;
  }, @Req() req: any) {
    return this.tenants.createLoanType(id, dto, this.actorFrom(req), this.ipFrom(req));
  }
}
