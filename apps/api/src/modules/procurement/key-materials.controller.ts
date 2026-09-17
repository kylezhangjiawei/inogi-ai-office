import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { KeyMaterialsService } from './key-materials.service';
import type { ProcActor } from './procurement.types';
class MappingDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsInt() @Min(0) version!: number;
  @IsArray() @ArrayMaxSize(2000) @IsString({ each: true }) @MaxLength(128, { each: true }) materialIds!: string[];
  @IsIn(['included', 'pending', 'excluded']) inclusion!: 'included' | 'pending' | 'excluded';
  @IsString() @MaxLength(4000) note!: string;
}
type AuthedRequest = { user: { id: string; name?: string; username?: string; permissions: string[] } };
@Controller('procurement/key-materials')
export class KeyMaterialsController {
  constructor(private readonly service: KeyMaterialsService) {}
  private actor(req: AuthedRequest): ProcActor { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }
  @Get() @Permissions('page:proc-key-materials')
  list(@Request() req: AuthedRequest) { return this.service.list(this.actor(req)); }
  @Get('monthly') @Permissions('page:proc-key-materials')
  monthly(@Query('month') month: string, @Query('date') date: string, @Request() req: AuthedRequest) { return this.service.monthly(month, date, this.actor(req)); }
  @Get('options') @Permissions('page:proc-key-materials')
  options(@Query('q') query: string, @Query('page') page: string, @Request() req: AuthedRequest) { return this.service.options(query, page === undefined ? 1 : Number(page), this.actor(req)); }
  @Get(':id/history') @Permissions('page:proc-key-materials')
  history(@Param('id') id: string, @Request() req: AuthedRequest) { return this.service.history(id, this.actor(req)); }
  @Post(':id/mapping') @Permissions('page:proc-key-materials')
  save(@Param('id') id: string, @Body() input: MappingDto, @Request() req: AuthedRequest) { return this.service.save(id, input, this.actor(req)); }
}
