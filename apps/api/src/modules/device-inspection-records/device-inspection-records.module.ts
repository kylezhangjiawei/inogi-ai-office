import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DeviceInspectionRecordsController, DeviceInspectionUploadController } from './device-inspection-records.controller';
import { DeviceInspectionRecordsService } from './device-inspection-records.service';
import { DeviceInspectionUploadGuard } from './device-inspection-upload.guard';

@Module({ imports: [PrismaModule, ConfigModule], controllers: [DeviceInspectionRecordsController, DeviceInspectionUploadController], providers: [DeviceInspectionRecordsService, DeviceInspectionUploadGuard] })
export class DeviceInspectionRecordsModule {}
