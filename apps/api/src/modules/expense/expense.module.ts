import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';

@Module({
  imports: [PrismaModule, SecurityModule],
  controllers: [ExpenseController],
  providers: [ExpenseService],
})
export class ExpenseModule {}
