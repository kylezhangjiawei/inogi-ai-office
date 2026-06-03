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

  /**
   * 探活：embedding 模型是否配置 + 当前索引文档数。前端用来显示"RAG 就绪/未配置"徽章。
   * reason：未就绪的具体原因（模型未配置 / 密钥解密失败 / 密钥为空 / 知识库未回填），
   * 便于线上「RAG 未启用」时一眼定位，而不用翻服务端日志。
   */
  @Get('status')
  async getStatus() {
    let embeddingConfigured = false;
    let embeddingModel: string | null = null;
    let reason: string | null = null;
    try {
      const cfg = await this.embedding.loadConfig();
      embeddingConfigured = Boolean(cfg.apiKey);
      embeddingModel = cfg.model;
      if (!embeddingConfigured) {
        reason = 'Embedding 模型密钥为空，请在「AI 模型管理」补全。';
      }
    } catch (err) {
      // loadConfig 在「未配置 / 解密失败 / 密钥为空」时抛 BadRequestException，
      // 把它的 message 透出，让前端徽章直接显示原因。
      embeddingConfigured = false;
      reason = err instanceof Error ? err.message : 'Embedding 模型加载失败';
    }
    const chunkCount = await this.prisma.knowledgeChunk
      .count({ where: { archived: false } })
      .catch(() => 0);
    if (embeddingConfigured && chunkCount === 0) {
      reason = '已配置 Embedding 模型，但知识库暂无可检索的索引，请管理员触发「KB→RAG 回填」。';
    }
    return { embeddingConfigured, embeddingModel, chunkCount, reason };
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
