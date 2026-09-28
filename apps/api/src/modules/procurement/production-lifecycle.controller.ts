import { Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { IsInt, IsObject, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ProductionLifecycleService } from './production-lifecycle.service';
import { ProductionReadinessService } from './production-readiness.service';
class LifecycleCommandDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @MaxLength(40) action!: string;
  @IsInt() @Min(0) version!: number;
  @IsObject() data!: Record<string, unknown>;
}
type AuthedRequest = { user: { id: string; name?: string; permissions: string[] } };
@Controller('procurement/production-execution/:id')
export class ProductionLifecycleController {
  constructor(private readonly lifecycle: ProductionLifecycleService, private readonly readiness: ProductionReadinessService) {}
  private actor(req: AuthedRequest) { return { id: req.user.id, name: req.user.name ?? '', permissions: req.user.permissions }; }
  @Get('lifecycle') @Permissions('page:production-execution')
  read(@Param('id') id: string, @Request() req: AuthedRequest) { return this.lifecycle.read(id, this.actor(req)); }
  @Get('lifecycle/documents/:versionId') @Permissions('page:production-execution')
  document(@Param('id') id: string, @Param('versionId') versionId: string, @Request() req: AuthedRequest) { return this.lifecycle.document(id, versionId, this.actor(req)); }
  @Post('lifecycle') @Permissions('page:production-execution')
  command(@Param('id') id: string, @Body() input: LifecycleCommandDto, @Request() req: AuthedRequest) { return this.lifecycle.command(id, input, this.actor(req)); }
  @Get('readiness') @Permissions('page:production-execution')
  ready(@Param('id') id: string, @Query('date') date: string, @Query('snapshotId') snapshotId: string | undefined, @Request() req: AuthedRequest, @Query('batchId') batchId?: string) { return this.readiness.read(id, date, this.actor(req), snapshotId, batchId); }
  @Post('readiness') @Permissions('production:plan')
  confirm(@Param('id') id: string, @Body() input: LifecycleCommandDto, @Request() req: AuthedRequest) { return this.readiness.command(id, input, this.actor(req)); }
}
