import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { IsInt, IsObject, IsString, Matches, MaxLength, Min, IsNumber } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ProductionExecutionService } from './production-execution.service';
import type { ProcActor } from './procurement.types';
class CreatePlanDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(7) month!: string;
  @IsString() @MaxLength(200) productId!: string;
  @IsString() @MaxLength(200) deviceId!: string;
  @IsString() @MaxLength(200) bomRevisionId!: string;
  @IsNumber() targetQty!: number;
  @IsNumber() shipmentTargetQty!: number;
  @IsString() @MaxLength(2000) reason!: string;
}
class ExecutionCommandDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsInt() @Min(1) version!: number;
  @IsString() @MaxLength(30) action!: string;
  @IsObject() data!: Record<string, unknown>;
}
type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };
@Controller('procurement/production-execution')
export class ProductionExecutionController {
  constructor(private readonly service: ProductionExecutionService) {}
  private actor(req: AuthedRequest): ProcActor { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }
  @Get() @Permissions('page:production-execution')
  list(@Query('month') month: string, @Request() req: AuthedRequest) { return this.service.list(month, this.actor(req)); }
  @Get('overview') @Permissions('page:production-execution', 'page:rd-director-dashboard')
  overview(@Query('month') month: string, @Request() req: AuthedRequest) { return this.service.overview(month, this.actor(req)); }
  @Get('options') @Permissions('page:production-execution')
  options(@Request() req: AuthedRequest) { return this.service.options(this.actor(req)); }
  @Get('bom') @Permissions('page:production-execution')
  bom(@Query('productLine') productLine: string, @Request() req: AuthedRequest) { return this.service.bom(productLine, this.actor(req)); }
  @Post() @Permissions('production:plan')
  create(@Body() input: CreatePlanDto, @Request() req: AuthedRequest) { return this.service.create({ ...input }, this.actor(req)); }
  @Post(':id/commands') @Permissions('production:plan', 'proc-production:report', 'production:inspect', 'proc-quality:manage', 'proc-quality:collaborate')
  command(@Param('id') id: string, @Body() input: ExecutionCommandDto, @Request() req: AuthedRequest) { return this.service.command(id, input, this.actor(req)); }
}
