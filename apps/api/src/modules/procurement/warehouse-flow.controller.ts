import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsString, Matches, MaxLength, Min, ArrayMaxSize, IsBoolean, IsOptional } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { WarehouseFlowService } from './warehouse-flow.service';
class WarehouseCommandDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsInt() @Min(1) version!: number;
  @IsIn(['issue', 'sign']) action!: string;
  @IsString() @MaxLength(2000) reason!: string;
  @IsArray() @ArrayMaxSize(2000) lines!: Array<{ code: string; quantity: number; warehouse?: string }>;
}
class WarehouseReconcileDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsInt() @Min(1) version!: number;
  @IsString() @MaxLength(128) eventId!: string;
  @IsString() @MaxLength(2000) reason!: string;
  @IsOptional() @IsBoolean() revoke?: boolean;
  @IsOptional() @IsString() @MaxLength(128) voucherNumber?: string;
  @IsOptional() @IsBoolean() posted?: boolean;
  @IsOptional() @IsBoolean() detailsMatch?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(2000) lines?: Array<{ code: string; voucherLine: string; quantity: number; voucherQuantity: number }>;
}
type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };
@Controller('procurement/warehouse-flow')
export class WarehouseFlowController {
  constructor(private readonly service: WarehouseFlowService) {}
  private actor(req: AuthedRequest) { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }
  @Get() @Permissions('page:warehouse-flow', 'page:production-execution')
  list(@Query() query: { taskId?: string; status?: string }, @Request() req: AuthedRequest) { return this.service.list(query, this.actor(req)); }
  @Post(':id/commands') @Permissions('page:warehouse-flow', 'page:production-execution')
  command(@Param('id') id: string, @Body() input: WarehouseCommandDto, @Request() req: AuthedRequest) { return this.service.command(id, input, this.actor(req)); }
  @Post(':id/reconciliations') @Permissions('warehouse:reconcile')
  reconcile(@Param('id') id: string, @Body() input: WarehouseReconcileDto, @Request() req: AuthedRequest) { return this.service.reconcile(id, input, this.actor(req)); }
}
