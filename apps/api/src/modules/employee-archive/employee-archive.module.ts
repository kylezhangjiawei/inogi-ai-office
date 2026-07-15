import { Module } from '@nestjs/common';

import { EmployeeArchiveController } from './employee-archive.controller';
import { EmployeeArchiveService } from './employee-archive.service';

@Module({
  controllers: [EmployeeArchiveController],
  providers: [EmployeeArchiveService],
  exports: [EmployeeArchiveService],
})
export class EmployeeArchiveModule {}
