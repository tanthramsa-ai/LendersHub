import {
  Controller, Get, Post, Put, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ConfigureSubscriptionDto } from './dto/configure-subscription.dto';
import { SuperAdminJwtGuard } from '../guards/super-admin-jwt.guard';

@UseGuards(SuperAdminJwtGuard)
@Controller('api/v1/super-admin/tenants')
export class TenantController {
  constructor(private tenants: TenantService) {}

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
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
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
  configureSubscription(@Param('id') id: string, @Body() dto: ConfigureSubscriptionDto) {
    return this.tenants.configureSubscription(id, dto);
  }
}
