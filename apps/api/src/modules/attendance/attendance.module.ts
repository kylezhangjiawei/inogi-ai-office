import { Module } from '@nestjs/common';

import { AttendanceController } from './attendance.controller';
import { AttendanceImportService } from './attendance-import.service';
import { AttendanceService } from './attendance.service';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceImportService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
