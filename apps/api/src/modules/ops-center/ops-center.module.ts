import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { OpsCenterController } from './ops-center.controller';
import { OpsCenterService } from './ops-center.service';
import { OpsAiService } from './ops-ai.service';

@Module({
  imports: [PrismaModule, AiGatewayModule],
  controllers: [OpsCenterController],
  providers: [OpsCenterService, OpsAiService],
})
export class OpsCenterModule {}
