import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BomRevisionsService } from './bom-revisions.service';
import type { ProcActor } from './procurement.types';

class BomRequestDto {
  @Matches(/^[A-Za-z0-9_-]{16,128}$/) requestId!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
}
class BomPublishDto extends BomRequestDto {
  @Matches(/^[a-f0-9]{64}$/) expectedFingerprint!: string;
}
class BomBindDto extends BomPublishDto {
  @IsString() @IsNotEmpty() @MaxLength(200) productRootId!: string;
}
type Authed = { user: { id: string; name?: string; username?: string; permissions?: string[] } };
@Controller('procurement/bom-devices')
export class BomRevisionsController {
  constructor(private readonly service: BomRevisionsService) {}
  private actor(req: Authed): ProcActor { return { id: req.user.id, name: req.user.name ?? req.user.username ?? '', permissions: req.user.permissions ?? [] }; }
  @Get('options') @Permissions('page:proc-materials', 'page:proc-cockpit', 'page:proc-inventory-readiness')
  options(@Request() req: Authed) { return this.service.options(this.actor(req)); }
  @Get(':id/revisions') @Permissions('page:proc-materials', 'page:proc-cockpit', 'page:proc-inventory-readiness')
  read(@Param('id') id: string, @Request() req: Authed) { return this.service.read(id, this.actor(req)); }
  @Post(':id/bind') @Permissions('bom:publish')
  bind(@Param('id') id: string, @Body() body: BomBindDto, @Request() req: Authed) { return this.service.bind(id, body, this.actor(req)); }
  @Post(':id/publish') @Permissions('bom:publish')
  publish(@Param('id') id: string, @Body() body: BomPublishDto, @Request() req: Authed) { return this.service.publish(id, body, this.actor(req)); }
  @Post('revisions/:revisionId/retire') @Permissions('bom:publish')
  retire(@Param('revisionId') id: string, @Body() body: BomRequestDto, @Request() req: Authed) { return this.service.retire(id, body, this.actor(req)); }
}
