import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminAuthController } from './super-admin-auth.controller';
import { SuperAdminJwtStrategy } from './strategies/super-admin-jwt.strategy';
import { SuperAdminTempStrategy } from './strategies/super-admin-temp.strategy';
import { DashboardService } from './dashboard/dashboard.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { TenantService } from './tenants/tenant.service';
import { TenantController } from './tenants/tenant.controller';
import { EmailService } from './tenants/email.service';
import { VercelDomainService } from './tenants/vercel-domain.service';
import { UsersService } from './users/users.service';
import { UsersController } from './users/users.controller';
import { SystemHealthService } from './system-health/system-health.service';
import { SystemHealthController } from './system-health/system-health.controller';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
    }),
  ],
  providers: [
    SuperAdminAuthService,
    SuperAdminJwtStrategy,
    SuperAdminTempStrategy,
    DashboardService,
    TenantService,
    EmailService,
    VercelDomainService,
    UsersService,
    SystemHealthService,
  ],
  controllers: [SuperAdminAuthController, DashboardController, TenantController, UsersController, SystemHealthController],
})
export class SuperAdminModule {}
