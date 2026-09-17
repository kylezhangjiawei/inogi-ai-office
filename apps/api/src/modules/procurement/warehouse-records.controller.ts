import { Body, Controller, Get, Post, Request } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { WarehouseRecordsService } from './warehouse-records.service';
class RecordCommandDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(40) action!: string;
  @IsOptional() @IsString() @MaxLength(128) id?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsObject() data!: Record<string, unknown>;
}
type AuthedRequest = { user: { id: string; name?: string; permissions: string[] } };
@Controller('procurement/warehouse-records')
export class WarehouseRecordsController {
  constructor(private readonly service: WarehouseRecordsService) {}
  private actor(req: AuthedRequest) { return { id: req.user.id, name: req.user.name ?? '', permissions: req.user.permissions }; }
  @Get() @Permissions('page:warehouse-flow', 'page:production-execution')
  list(@Request() req: AuthedRequest) { return this.service.list(this.actor(req)); }
  @Post() @Permissions('page:warehouse-flow', 'page:production-execution')
  command(@Body() input: RecordCommandDto, @Request() req: AuthedRequest) { return this.service.command(input, this.actor(req)); }
}
