import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { ChatArchiveService } from './chat-archive.service';
type AuthRequest = { user: { id: string; permissions: string[]; name?: string } };
const offsetOf = (value?: string) => {
  const offset = Number(value ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new BadRequestException('分页位置无效');
  return offset;
};
const conversationOf = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new BadRequestException('缺少有效的会话编号');
  return value;
};
@Controller('chat')
export class ChatArchiveController {
  constructor(private readonly archives: ChatArchiveService) {}
  @Post('files/search')
  search(@Body() body: Record<string, unknown>, @Request() req: AuthRequest) {
    return this.archives.search(body, { userId: req.user.id, permissions: req.user.permissions, name: req.user.name }, conversationOf(body?.conversationId));
  }
  @Get('file-selections/:id')
  selection(@Param('id') id: string, @Query('conversationId') conversationId: string, @Query('offset') offset: string, @Request() req: AuthRequest) {
    return this.archives.selection(id, req.user.id, conversationOf(conversationId), offsetOf(offset));
  }
  @Post('archives')
  create(@Body() body: Record<string, unknown>, @Request() req: AuthRequest) {
    return this.archives.create(body, { userId: req.user.id, permissions: req.user.permissions }, conversationOf(body?.conversationId));
  }
  @Get('conversations/:id/file-selections')
  selections(@Param('id') id: string, @Request() req: AuthRequest) { return this.archives.recentSelections(req.user.id, id); }
  @Get('conversations/:id/archives')
  list(@Param('id') id: string, @Request() req: AuthRequest) { return this.archives.list(req.user.id, id); }
  @Get('archives/:id')
  report(@Param('id') id: string, @Query('offset') offset: string, @Request() req: AuthRequest) { return this.archives.report(id, req.user.id, offsetOf(offset)); }
  @Post('archives/:id/cancel')
  cancel(@Param('id') id: string, @Request() req: AuthRequest) { return this.archives.cancel(id, req.user.id); }
  @Post('archives/:id/retry')
  retry(@Param('id') id: string, @Request() req: AuthRequest) { return this.archives.retry(id, req.user.id); }
  @Post('archives/:id/download')
  download(@Param('id') id: string, @Request() req: AuthRequest) { return this.archives.download(id, req.user.id); }
}
