import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { TenantCustomersService, CreateCustomerDto, UpdateCustomerDto } from './tenant-customers.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/customers')
@UseGuards(TenantJwtGuard)
export class TenantCustomersController {
  constructor(private svc: TenantCustomersService) {}

  @Get()
  list(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.svc.list(req.user, page, Math.min(limit, 100), search, branchId);
  }

  @Get(':id')
  findOne(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.findOne(req.user, id);
  }

  @Post()
  create(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateCustomerDto) {
    return this.svc.create(req.user, dto);
  }

  @Put(':id')
  update(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.svc.update(req.user, id, dto);
  }
}
