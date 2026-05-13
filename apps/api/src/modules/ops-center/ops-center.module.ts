import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { OpsCenterController } from './ops-center.controller';
import { OpsCenterService } from './ops-center.service';

@Module({
  imports: [PrismaModule],
  controllers: [OpsCenterController],
  providers: [OpsCenterService],
})
export class OpsCenterModule {}
