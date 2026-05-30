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

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import type { RagUserContext } from '../rag/rag.service';

type AuthedRequest = { user: { id: string; permissions: string[] } };

const SUPER_ADMIN_PERMISSION = '*';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  /** 构造 RAG/Chat 通用的用户上下文（含 kbLevel 与个人画像） */
  private async buildUserContext(req: AuthedRequest): Promise<RagUserContext> {
    const userId = req.user.id;
    const permissions = req.user.permissions ?? [];
    const isSuper = permissions.includes(SUPER_ADMIN_PERMISSION);

    // 1) 用户基本信息（姓名/部门/角色名）
    let name: string | undefined;
    let department: string | undefined;
    let roleName: string | undefined;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, department: true, role: { select: { name: true } } },
      });
      if (user) {
        name = user.name ?? undefined;
        department = user.department ?? undefined;
        roleName = user.role?.name ?? undefined;
      }
    } catch {
      // 用户档案查不到不阻塞聊天
    }

    // 2) 研发岗位 + kbLevel（都来自 rd.people）
    let position: string | undefined;
    let kbLevel = isSuper ? 100 : 0;
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'rd.people' },
        select: { value: true },
      });
      const arr = Array.isArray(setting?.value) ? (setting!.value as unknown[]) : [];
      const person = arr.find((p): p is Record<string, unknown> => {
        if (!p || typeof p !== 'object') return false;
        return (p as Record<string, unknown>).user_id === userId;
      });
      if (person) {
        if (!isSuper && typeof person.kb_level === 'number' && Number.isFinite(person.kb_level)) {
          kbLevel = Math.max(0, Math.min(100, Math.round(person.kb_level as number)));
        }
        if (typeof person.position === 'string' && person.position.trim()) {
          position = person.position.trim();
        }
      }
    } catch {
      // 拿不到 person 记录就当 kbLevel=0，不阻塞聊天
    }

    return { userId, permissions, kbLevel, name, department, roleName, position };
  }

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
    const userContext = await this.buildUserContext(req);
    await this.chatService.streamMessage(id, dto, userContext, res);
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
