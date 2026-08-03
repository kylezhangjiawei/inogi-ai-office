import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionCatalogController } from './permission-catalog.controller';
import { PermissionCatalogService } from './permission-catalog.service';

@Module({
  imports: [PrismaModule],
  controllers: [PermissionCatalogController],
  providers: [PermissionCatalogService],
  // AuthModule 需要它来剔除已停用的权限码（停用 = 对所有人失效）
  exports: [PermissionCatalogService],
})
export class PermissionCatalogModule {}
