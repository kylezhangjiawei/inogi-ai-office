import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ErpPurchaseOrderService, ERP_ORDER_WRITE_PERMISSION } from './erp-purchase-order.service';
import type { ProcActor } from './procurement.types';
import type { OrderWrite } from './erp-purchase-order';
@Controller('procurement/tplus/purchase-order-actions')
export class ErpPurchaseOrderController {
 constructor(private readonly orders:ErpPurchaseOrderService) {}
 private actor(req:{user:{id:string;name?:string;username?:string;permissions:string[]}}):ProcActor {return{id:req.user.id,name:req.user.name??req.user.username??'',permissions:req.user.permissions??[]};}
 @Get('options') @Permissions(ERP_ORDER_WRITE_PERMISSION)
 options(@Request() req:any){return this.orders.options(this.actor(req));}
 @Get('requests/:requestId') @Permissions(ERP_ORDER_WRITE_PERMISSION)
 status(@Param('requestId') requestId:string,@Request() req:any){return this.orders.requestStatus(requestId,this.actor(req));}
 @Get('pending') @Permissions(ERP_ORDER_WRITE_PERMISSION)
 pending(@Query('orderNo') orderNo:string|undefined,@Request() req:any){return this.orders.pending(this.actor(req),orderNo);}
 @Get(':orderNo') @Permissions(ERP_ORDER_WRITE_PERMISSION,'proc:sync-erp')
 read(@Param('orderNo') orderNo:string,@Request() req:any){return this.orders.read(orderNo,this.actor(req));}
 @Post() @Permissions(ERP_ORDER_WRITE_PERMISSION)
 write(@Body() body:OrderWrite,@Request() req:any){return this.orders.write(body,this.actor(req));}
}
