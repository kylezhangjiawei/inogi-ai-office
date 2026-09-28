import { Controller, Get, Param, Request } from '@nestjs/common';
import { RDRelatedRecordsService } from './rd-related-records.service';
type Authed = { user: { id: string; name?: string; permissions: string[] } };
@Controller('procurement/related-records')
export class RDRelatedRecordsController {
  constructor(private readonly service: RDRelatedRecordsService) {}
  private actor(req: Authed) { return { id: req.user.id, name: req.user.name ?? '', permissions: req.user.permissions ?? [] }; }
  @Get('mine') mine(@Request() req: Authed) { return this.service.mine(this.actor(req)); }
  @Get('rd/:id') related(@Param('id') id: string, @Request() req: Authed) { return this.service.related(id, this.actor(req)); }
}
