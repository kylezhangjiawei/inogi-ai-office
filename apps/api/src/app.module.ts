import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaModule } from './prisma/prisma.module';
import { MulterConfigModule } from './modules/multer-config/multer-config.module';
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
import { ImageGenerationModule } from './modules/image-generation/image-generation.module';
import { OpsCenterModule } from './modules/ops-center/ops-center.module';
import { PermissionCatalogModule } from './modules/permission-catalog/permission-catalog.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { ResearchDevelopmentModule } from './modules/research-development/research-development.module';
import { OssModule } from './modules/oss/oss.module';
import { FilesModule } from './modules/files/files.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { ApiRequestLogInterceptor } from './modules/ops-center/api-request-log.interceptor';

const envFilePath = [
  join(process.cwd(), 'apps/api/.env'),
  join(process.cwd(), '.env'),
].filter(existsSync);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePath.length > 0 ? envFilePath : undefined,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    MulterConfigModule,
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
    ImageGenerationModule,
    OpsCenterModule,
    PermissionCatalogModule,
    OssModule,
    FilesModule,
    ExpenseModule,
    ResearchDevelopmentModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiRequestLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
