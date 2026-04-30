import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { SystemSettingsModule } from './modules/system-settings/system-settings.module';
import { ResumeScreeningModule } from './modules/resume-screening/resume-screening.module';
import { SecurityModule } from './modules/security/security.module';
import { AuthModule } from './modules/auth/auth.module';
import { DictionariesModule } from './modules/dictionaries/dictionaries.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { IntegrationManagementModule } from './modules/integration-management/integration-management.module';
import { ChatModule } from './modules/chat/chat.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AuditInterceptor } from './modules/audit/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    HealthModule,
    UsersModule,
    RolesModule,
    SystemSettingsModule,
    SecurityModule,
    AuthModule,
    ResumeScreeningModule,
    DictionariesModule,
    DepartmentsModule,
    IntegrationManagementModule,
    ChatModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
