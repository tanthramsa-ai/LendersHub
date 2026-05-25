import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TenantAuthService } from './auth/tenant-auth.service';
import { TenantAuthController } from './auth/tenant-auth.controller';
import { TenantJwtStrategy } from './auth/strategies/tenant-jwt.strategy';
import { TenantDashboardService } from './dashboard/tenant-dashboard.service';
import { TenantDashboardController } from './dashboard/tenant-dashboard.controller';
import { TenantCustomersService } from './customers/tenant-customers.service';
import { TenantCustomersController } from './customers/tenant-customers.controller';
import { TenantLoansService } from './loans/tenant-loans.service';
import { TenantLoansController } from './loans/tenant-loans.controller';
import { TenantCollectionsService } from './collections/tenant-collections.service';
import { TenantCollectionsController } from './collections/tenant-collections.controller';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  providers: [
    TenantAuthService,
    TenantJwtStrategy,
    TenantDashboardService,
    TenantCustomersService,
    TenantLoansService,
    TenantCollectionsService,
  ],
  controllers: [
    TenantAuthController,
    TenantDashboardController,
    TenantCustomersController,
    TenantLoansController,
    TenantCollectionsController,
  ],
})
export class TenantModule {}
