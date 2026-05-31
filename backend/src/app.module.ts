import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AppCacheModule } from './cache/cache.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { TenantModule } from './tenant/tenant.module';
import { RlsModule } from './rls/rls.module';
import { TenantRlsMiddleware } from './middleware/tenant-rls.middleware';
import { SmsModule } from './sms/sms.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RlsModule, AppCacheModule, PrismaModule, AuthModule,
    SmsModule, WhatsAppModule,
    SuperAdminModule, TenantModule,
    SchedulerModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantRlsMiddleware).forRoutes('*');
  }
}
