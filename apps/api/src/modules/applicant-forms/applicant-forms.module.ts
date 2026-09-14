import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { ApplicantFormsController, PublicApplicantFormsController } from './applicant-forms.controller';
import { ApplicantFormsService } from './applicant-forms.service';

@Module({
  imports: [AiGatewayModule],
  controllers: [ApplicantFormsController, PublicApplicantFormsController],
  providers: [ApplicantFormsService],
  exports: [ApplicantFormsService],
})
export class ApplicantFormsModule {}
