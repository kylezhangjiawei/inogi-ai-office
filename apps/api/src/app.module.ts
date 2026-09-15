import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaModule } from './prisma/prisma.module';
import { MulterConfigModule } from './modules/multer-config/multer-config.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { SystemSettingsModule } from './modules/system-settings/system-settings.module';
import { ElectronicGateModule } from './modules/electronic-gate/electronic-gate.module';
import { DeviceInspectionRecordsModule } from './modules/device-inspection-records/device-inspection-records.module';
import { ResumeScreeningModule } from './modules/resume-screening/resume-screening.module';
import { SecurityModule } from './modules/security/security.module';
import { AuthModule } from './modules/auth/auth.module';
import { DictionariesModule } from './modules/dictionaries/dictionaries.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { IntegrationManagementModule } from './modules/integration-management/integration-management.module';
import { ChatModule } from './modules/chat/chat.module';
import { ImageGenerationModule } from './modules/image-generation/image-generation.module';
import { VideoGenerationModule } from './modules/video-generation/video-generation.module';
import { AiUsageModule } from './modules/ai-usage/ai-usage.module';
import { ContentSlotsModule } from './modules/content-slots/content-slots.module';
import { AuditModule } from './modules/audit/audit.module';
import { OpsCenterModule } from './modules/ops-center/ops-center.module';
import { PermissionCatalogModule } from './modules/permission-catalog/permission-catalog.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { ResearchDevelopmentModule } from './modules/research-development/research-development.module';
import { OssModule } from './modules/oss/oss.module';
import { FilesModule } from './modules/files/files.module';
import { RagModule } from './modules/rag/rag.module';
import { OrderProcessingModule } from './modules/order-processing/order-processing.module';
import { IssueModule } from './modules/issue/issue.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { EmployeeArchiveModule } from './modules/employee-archive/employee-archive.module';
import { ApplicantFormsModule } from './modules/applicant-forms/applicant-forms.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ExternalDocsModule } from './modules/external-docs/external-docs.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { UserThrottlerGuard } from './common/user-throttler.guard';
import { GlobalExceptionFilter } from './common/global-exception.filter';
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
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    MulterConfigModule,
    PrismaModule,
    HealthModule,
    UsersModule,
    RolesModule,
    SystemSettingsModule,
    ElectronicGateModule,
    DeviceInspectionRecordsModule,
    SecurityModule,
    AuthModule,
    ResumeScreeningModule,
    DictionariesModule,
    DepartmentsModule,
    IntegrationManagementModule,
    ChatModule,
    ImageGenerationModule,
    VideoGenerationModule,
    AiUsageModule,
    ContentSlotsModule,
    AuditModule,
    OpsCenterModule,
    PermissionCatalogModule,
    OssModule,
    FilesModule,
    OrderProcessingModule,
    ProcurementModule,
    ExpenseModule,
    RagModule,
    ResearchDevelopmentModule,
    IssueModule,
    EmployeeArchiveModule,
    ApplicantFormsModule,
    AttendanceModule,
    ExternalDocsModule,
    AiGatewayModule,
    I18nModule,
  ],
  providers: [
    // 全局兜底异常过滤器：HttpException 原样透传（前端契约不变），其余未捕获异常统一 500 + 日志、不泄露堆栈。
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // 顺序：先鉴权（设置 req.user）→ 再按用户限流 → 最后鉴别角色。
    // 限流改为「按登录用户」计数（UserThrottlerGuard），解决办公网共享 IP 被打满导致的 429。
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiRequestLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
