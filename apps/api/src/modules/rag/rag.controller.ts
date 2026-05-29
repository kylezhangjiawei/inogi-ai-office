import { Body, Controller, Get, Post, Request } from '@nestjs/common';

import { RagService, RagSourceType, RagUserContext } from './rag.service';
import { RagChatDto, RagSearchDto } from './dto/rag-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingClient } from './embedding-client';

type AuthedRequest = { user: { id: string; permissions: string[] } };

const SUPER_ADMIN_PERMISSION = '*';

@Controller('rag')
export class RagController {
  constructor(
    private readonly rag: RagService,
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingClient,
  ) {}

  /** 探活：embedding 模型是否配置 + 当前索引文档数。前端用来显示"RAG 就绪/未配置"徽章 */
  @Get('status')
  async getStatus() {
    let embeddingConfigured = false;
    let embeddingModel: string | null = null;
    try {
      const cfg = await this.embedding.loadConfig();
      embeddingConfigured = Boolean(cfg.apiKey);
      embeddingModel = cfg.model;
    } catch {
      embeddingConfigured = false;
    }
    const chunkCount = await this.prisma.knowledgeChunk
      .count({ where: { archived: false } })
      .catch(() => 0);
    return { embeddingConfigured, embeddingModel, chunkCount };
  }

  @Post('search')
  async search(@Body() dto: RagSearchDto, @Request() req: AuthedRequest) {
    const user = await this.buildUserContext(req);
    return this.rag.search(dto.query, user, {
      topK: dto.topK,
      sourceTypes: dto.sourceTypes as RagSourceType[] | undefined,
    });
  }

  @Post('chat')
  async chat(@Body() dto: RagChatDto, @Request() req: AuthedRequest) {
    const user = await this.buildUserContext(req);
    return this.rag.chat(dto.query, user, {
      topK: dto.topK,
      sourceTypes: dto.sourceTypes as RagSourceType[] | undefined,
    });
  }

  /**
   * 取 user context 时附带 kbLevel（从 person 记录查）。超管不查 kbLevel，hasAccess 直接放行。
   */
  private async buildUserContext(req: AuthedRequest): Promise<RagUserContext> {
    const userId = req.user.id;
    const permissions = req.user.permissions ?? [];
    const isSuper = permissions.includes(SUPER_ADMIN_PERMISSION);

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
      // 查不到不阻塞
    }

    let position: string | undefined;
    let kbLevel = isSuper ? 100 : 0;
    try {
      // person 记录目前存在 SystemSetting.rd.people 的 JSON 数组里
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
          kbLevel = Math.max(0, Math.min(100, Math.round(person.kb_level)));
        }
        if (typeof person.position === 'string' && person.position.trim()) {
          position = person.position.trim();
        }
      }
    } catch {
      // ignore
    }
    return { userId, permissions, kbLevel, name, department, roleName, position };
  }
}
