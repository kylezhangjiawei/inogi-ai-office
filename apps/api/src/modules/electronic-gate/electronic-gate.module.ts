import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ElectronicGateController } from './electronic-gate.controller';
import { ElectronicGateService } from './electronic-gate.service';
import { FactoryQcManagementController, FactoryQcPublicController } from './factory-qc.controller';
import { FactoryQcService } from './factory-qc.service';

@Module({ imports: [PrismaModule], controllers: [ElectronicGateController, FactoryQcManagementController, FactoryQcPublicController], providers: [ElectronicGateService, FactoryQcService] })
export class ElectronicGateModule {}
