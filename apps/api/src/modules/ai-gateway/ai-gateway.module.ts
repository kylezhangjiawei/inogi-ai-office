import { Module } from '@nestjs/common';

import { AiGatewayService } from './ai-gateway.service';
import { AiGatewayController } from './ai-gateway.controller';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

@Module({
  controllers: [AiGatewayController],
  providers: [AiGatewayService, OpenAiCompatibleAdapter],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
