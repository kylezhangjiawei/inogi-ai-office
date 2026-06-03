import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { OrderProcessingService } from './order-processing.service';

@Controller('order-processing')
export class OrderProcessingController {
  constructor(private readonly service: OrderProcessingService) {}

  @Get('workbench')
  getWorkbench(@Query() query: Record<string, unknown>) {
    return this.service.getWorkbench(query);
  }

  @Post('orders/upload')
  @UseInterceptors(FilesInterceptor('files', 20))
  uploadOrders(
    @UploadedFiles() files: Array<{ originalname: string; size?: number; mimetype?: string; buffer?: Buffer }> | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.service.uploadOrders(files ?? [], payload);
  }

  @Post('orders/sync-mail')
  syncWecomMailOrders(@Body() payload: Record<string, unknown>) {
    return this.service.syncWecomMailOrders(payload);
  }

  @Post('orders/:orderId/generate-invoice')
  generateInvoice(@Param('orderId') orderId: string, @Body() payload: Record<string, unknown>) {
    return this.service.generateInvoice(orderId, payload);
  }

  @Post('orders/:orderId/export-invoice')
  exportInvoice(@Param('orderId') orderId: string) {
    return this.service.exportInvoice(orderId);
  }

  @Post('templates/active')
  saveActiveTemplate(@Body() payload: Record<string, unknown>) {
    return this.service.saveActiveTemplate(String(payload.templateId ?? ''));
  }

  @Post('templates')
  saveTemplate(@Body() payload: Record<string, unknown>) {
    return this.service.saveTemplate(payload);
  }

  @Post('templates/ai-generate')
  @UseInterceptors(FilesInterceptor('files', 10))
  generateAiTemplate(
    @UploadedFiles() files: Array<{ originalname: string; size?: number; mimetype?: string; buffer?: Buffer }> | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.service.generateAiTemplate(files ?? [], payload);
  }

  @Post('reminder-rule')
  saveReminderRule(@Body() payload: Record<string, unknown>) {
    return this.service.saveReminderRule(payload);
  }

  @Get('inventory')
  getInventory(@Query() query: Record<string, unknown>) {
    return this.service.getInventory(query);
  }

  @Get('inventory/:itemId')
  getInventoryDetail(@Param('itemId') itemId: string) {
    return this.service.getInventoryDetail(itemId);
  }

  @Post('inventory/ai-recognize')
  @UseInterceptors(FilesInterceptor('files', 10))
  recognizeStockIn(@UploadedFiles() files: Array<{ originalname: string; size?: number; mimetype?: string; buffer?: Buffer }> | undefined) {
    return this.service.recognizeStockIn(files ?? []);
  }

  @Post('inventory/stock-in')
  createStockIn(@Body() payload: Record<string, unknown>) {
    return this.service.createStockIn(payload);
  }

  @Post('inventory/export')
  exportInventory(@Query() query: Record<string, unknown>) {
    return this.service.exportInventory(query);
  }

  @Get('purchase-orders')
  getPurchaseOrders(@Query() query: Record<string, unknown>) {
    return this.service.getPurchaseOrders(query);
  }

  @Get('purchase-orders/:id')
  getPurchaseOrder(@Param('id') id: string) {
    return this.service.getPurchaseOrder(id);
  }

  @Post('purchase-orders/import')
  @UseInterceptors(FilesInterceptor('files', 5))
  importPurchaseOrders(
    @UploadedFiles() files: Array<{ originalname: string; size?: number; mimetype?: string; buffer?: Buffer }> | undefined,
  ) {
    return this.service.importPurchaseOrders(files ?? []);
  }

  @Post('inventory/:itemId/stock-out')
  createStockOut(@Param('itemId') itemId: string, @Body() payload: Record<string, unknown>) {
    return this.service.createStockOut(itemId, payload);
  }

  @Patch('inventory/:itemId/adjust')
  adjustInventory(@Param('itemId') itemId: string, @Body() payload: Record<string, unknown>) {
    return this.service.adjustInventory(itemId, payload);
  }
}
