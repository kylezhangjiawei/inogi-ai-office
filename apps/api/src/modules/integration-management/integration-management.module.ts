import { Module } from '@nestjs/common';

import { ResumeScreeningModule } from '../resume-screening/resume-screening.module';
import { IntegrationManagementController } from './integration-management.controller';
import { IntegrationManagementService } from './integration-management.service';

@Module({
  imports: [ResumeScreeningModule],
  controllers: [IntegrationManagementController],
  providers: [IntegrationManagementService],
})
export class IntegrationManagementModule {}
