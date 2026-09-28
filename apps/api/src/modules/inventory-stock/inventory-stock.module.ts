import { Module } from '@nestjs/common';
import { InventoryStockService } from './inventory-stock.service';

@Module({ providers: [InventoryStockService], exports: [InventoryStockService] })
export class InventoryStockModule {}
