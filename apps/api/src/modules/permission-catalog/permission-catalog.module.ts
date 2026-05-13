import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionCatalogController } from './permission-catalog.controller';
import { PermissionCatalogService } from './permission-catalog.service';

@Module({
  imports: [PrismaModule],
  controllers: [PermissionCatalogController],
  providers: [PermissionCatalogService],
})
export class PermissionCatalogModule {}
