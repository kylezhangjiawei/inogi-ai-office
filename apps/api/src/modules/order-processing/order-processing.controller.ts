import { Body, Controller, Get, Param, Patch, Post, Query, Request, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { OrderProcessingService } from './order-processing.service';
import { OrderStockService, type ConfirmOrderMaterial } from './order-stock.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { retiredInventoryWrite } from './retired-inventory';
type Authed = { user: { id: string; name?: string; username?: string; permissions?: string[] } };

@Controller('order-processing')
export class OrderProcessingController {
  constructor(private readonly service: OrderProcessingService, private readonly stock: OrderStockService) {}
  private actor(req: Authed) { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }

  @Get('material-options') @Permissions('page:order-workbench')
  materialOptions(@Query() query: Record<string, unknown>, @Request() req: Authed) { return this.stock.options(query, this.actor(req)); }

  @Post('orders/:orderId/lines/:lineId/material-mapping') @Permissions('order-processing:material-map')
  confirmMaterial(@Param('orderId') orderId: string, @Param('lineId') lineId: string, @Body() body: ConfirmOrderMaterial, @Request() req: Authed) { return this.stock.confirm(orderId, lineId, body, this.actor(req)); }

  @Get('workbench')
  @Permissions('page:order-workbench')
  getWorkbench(@Query() query: Record<string, unknown>, @Request() req: Authed) {
    return this.service.getWorkbench(query, this.actor(req));
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
  @Permissions('page:inventory-management')
  getInventory(@Query() query: Record<string, unknown>, @Request() req: Authed) {
    return this.service.getInventory(query, this.actor(req));
  }

  @Get('inventory/:itemId')
  @Permissions('page:inventory-management')
  getInventoryDetail(@Param('itemId') itemId: string, @Request() req: Authed) {
    return this.service.getInventoryDetail(itemId, this.actor(req));
  }

  @Post('inventory/ai-recognize')
  recognizeStockIn(@UploadedFiles() files: Array<{ originalname: string; size?: number; mimetype?: string; buffer?: Buffer }> | undefined) {
    return retiredInventoryWrite();
  }

  @Post('inventory/stock-in')
  createStockIn(@Body() payload: Record<string, unknown>) {
    return retiredInventoryWrite();
  }

  @Post('inventory/export')
  @Permissions('page:inventory-management')
  exportInventory(@Query() query: Record<string, unknown>, @Request() req: Authed) {
    return this.service.exportInventory(query, this.actor(req));
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
    return retiredInventoryWrite();
  }

  @Patch('inventory/:itemId/adjust')
  adjustInventory(@Param('itemId') itemId: string, @Body() payload: Record<string, unknown>) {
    return retiredInventoryWrite();
  }
}
