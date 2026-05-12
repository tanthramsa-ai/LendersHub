import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AppCacheModule } from './cache/cache.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { TenantModule } from './tenant/tenant.module';
import { RlsModule } from './rls/rls.module';
import { TenantRlsMiddleware } from './middleware/tenant-rls.middleware';

@Module({
  imports: [RlsModule, AppCacheModule, PrismaModule, AuthModule, SuperAdminModule, TenantModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantRlsMiddleware).forRoutes('*');
  }
}
