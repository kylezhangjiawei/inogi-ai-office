import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  Res,
} from '@nestjs/common';
import { Response } from 'express';

import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

type AuthedRequest = { user: { id: string; permissions: string[] } };

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ── Models ───────────────────────────────────────────────────────────────────

  @Get('models')
  listModels() {
    return this.chatService.listModels();
  }

  // ── Conversations ────────────────────────────────────────────────────────────

  @Get('conversations')
  listConversations(@Request() req: AuthedRequest) {
    return this.chatService.listConversations(req.user.id);
  }

  @Post('conversations')
  createConversation(@Body() dto: CreateConversationDto, @Request() req: AuthedRequest) {
    return this.chatService.createConversation(req.user.id, dto);
  }

  @Patch('conversations/:id')
  updateConversation(
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
    @Request() req: AuthedRequest,
  ) {
    return this.chatService.updateConversation(id, req.user.id, dto);
  }

  @Delete('conversations/:id')
  deleteConversation(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.chatService.deleteConversation(id, req.user.id);
  }

  // ── Messages ─────────────────────────────────────────────────────────────────

  @Get('conversations/:id/messages')
  getMessages(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.chatService.getMessages(id, req.user.id);
  }

  @Post('conversations/:id/messages')
  async streamMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Request() req: AuthedRequest,
    @Res() res: Response,
  ) {
    // Validation/auth errors (NotFoundException/ForbiddenException) throw BEFORE
    // res.write() is called, so the global exception filter handles them normally.
    await this.chatService.streamMessage(id, dto, req.user.id, res);
  }

  // ── Message actions ──────────────────────────────────────────────────────────

  @Patch('messages/:id/reaction')
  updateReaction(
    @Param('id') id: string,
    @Body() body: { reaction: string | null },
    @Request() req: AuthedRequest,
  ) {
    return this.chatService.updateReaction(id, req.user.id, body.reaction ?? null);
  }

  @Delete('messages/:id')
  deleteMessage(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.chatService.deleteMessage(id, req.user.id);
  }
}
