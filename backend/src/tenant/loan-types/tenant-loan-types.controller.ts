import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  UseGuards, Request, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { TenantLoanTypesService, CreateLoanTypeDto } from './tenant-loan-types.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/loan-types')
@UseGuards(TenantJwtGuard)
export class TenantLoanTypesController {
  constructor(private svc: TenantLoanTypesService) {}

  @Get()
  list(@Request() req: { user: TenantJwtPayload }) {
    return this.svc.list(req.user);
  }

  @Get(':id')
  findOne(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.findOne(req.user, id);
  }

  @Get(':id/loans')
  getLoansByType(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.svc.getLoansByType(req.user, id, page, Math.min(limit, 100), search);
  }

  @Get(':id/customers')
  getCustomersByType(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.svc.getCustomersByType(req.user, id, page, Math.min(limit, 100), search);
  }

  @Post()
  create(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateLoanTypeDto) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  update(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Body() dto: Partial<CreateLoanTypeDto> & { isActive?: boolean },
  ) {
    return this.svc.update(req.user, id, dto);
  }

  @Delete(':id')
  remove(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.remove(req.user, id);
  }
}
