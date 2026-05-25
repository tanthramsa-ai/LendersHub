import {
  Controller, Get, Post, Patch, Param, Body,
  Query, UseGuards, Request,
  ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { TenantUsersService, CreateUserDto, UpdateUserDto } from './tenant-users.service';
import { TenantJwtGuard } from '../auth/guards/tenant-jwt.guard';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Controller('api/v1/tenant/users')
@UseGuards(TenantJwtGuard)
export class TenantUsersController {
  constructor(private svc: TenantUsersService) {}

  @Get()
  list(
    @Request() req: { user: TenantJwtPayload },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.svc.list(req.user, page, Math.min(limit, 100), search);
  }

  @Get(':id')
  findOne(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.findOne(req.user, id);
  }

  @Post()
  create(@Request() req: { user: TenantJwtPayload }, @Body() dto: CreateUserDto) {
    return this.svc.create(req.user, dto);
  }

  @Patch(':id')
  update(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.svc.update(req.user, id, dto);
  }

  @Patch(':id/activate')
  activate(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.setActive(req.user, id, true);
  }

  @Patch(':id/deactivate')
  deactivate(@Request() req: { user: TenantJwtPayload }, @Param('id') id: string) {
    return this.svc.setActive(req.user, id, false);
  }

  @Patch(':id/reset-password')
  resetPassword(
    @Request() req: { user: TenantJwtPayload },
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    return this.svc.resetPassword(req.user, id, body.password);
  }
}
