import { Body, Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { ChatDeliveryService } from './chat-delivery.service';

type AuthRequest = { user: { id: string; permissions: string[]; name?: string } };
const viewer = (req: AuthRequest) => ({ userId: req.user.id, permissions: req.user.permissions, name: req.user.name });

@Controller('chat/delivery-checks')
export class ChatDeliveryController {
  constructor(private readonly delivery: ChatDeliveryService) {}

  @Post()
  create(@Body() body: Record<string, unknown>, @Request() req: AuthRequest) {
    return this.delivery.create(body, viewer(req));
  }

  @Get()
  list(@Query('conversationId') conversationId: string, @Request() req: AuthRequest) {
    return this.delivery.list(conversationId, viewer(req));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Request() req: AuthRequest) {
    return this.delivery.update(id, body, viewer(req));
  }

  @Post(':id/refresh')
  refresh(@Param('id') id: string, @Body() body: Record<string, unknown>, @Request() req: AuthRequest) {
    return this.delivery.refresh(id, body, viewer(req));
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @Body() body: Record<string, unknown>, @Request() req: AuthRequest) {
    return this.delivery.archive(id, body, viewer(req));
  }

  @Post(':id/files/:fileId/preview')
  preview(@Param('id') id: string, @Param('fileId') fileId: string, @Body() body: Record<string, unknown>, @Request() req: AuthRequest) {
    return this.delivery.preview(id, fileId, body, viewer(req));
  }
}
