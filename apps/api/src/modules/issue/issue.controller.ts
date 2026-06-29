import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { IssueService, type IssueActor } from './issue.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { ListIssuesQueryDto } from './dto/list-issues-query.dto';
import {
  AdjustIssueDto,
  AdoptIssueDto,
  ProcessAttachmentDto,
  ResolveIssueDto,
  SaveAiConfigDto,
  SendChatDto,
} from './dto/issue-actions.dto';

type AuthedRequest = { user: { id: string; permissions: string[] } };

const SUPER_ADMIN_PERMISSION = '*';
const RESOLVE_PERMISSION = 'issue:resolve';
const CREATE_PERMISSION = 'issue:create';

@Controller('issues')
export class IssueController {
  constructor(
    private readonly issueService: IssueService,
    private readonly prisma: PrismaService,
  ) {}

  // ── 列表 / 统计 / 选项 ─────────────────────────────────────────────────────

  @Get()
  list(@Query() query: ListIssuesQueryDto) {
    return this.issueService.list(query);
  }

  @Get('stats')
  stats() {
    return this.issueService.stats();
  }

  @Get('dimension-stats')
  dimensionStats() {
    return this.issueService.dimensionStats();
  }

  @Get('products')
  products() {
    return this.issueService.productOptions();
  }

  // ── 异步任务轮询（声明在 :id 之前；长耗时 AI 分析走 taskId）─────────────────
  @Get('tasks/:taskId')
  getTask(@Param('taskId') taskId: string) {
    return this.issueService.getTask(taskId);
  }

  // ── AI 配置 / 模型 ──────────────────────────────────────────────────────────

  @Get('ai/models')
  listAiModels() {
    return this.issueService.listAiModels();
  }

  @Get('ai/config')
  getAiConfig() {
    return this.issueService.getAiConfig();
  }

  @Put('ai/config')
  setAiConfig(@Body() dto: SaveAiConfigDto, @Request() req: AuthedRequest) {
    this.assertResolvePermission(req);
    return this.issueService.setAiConfig(dto);
  }

  @Post('process-attachment')
  async processAttachment(@Body() dto: ProcessAttachmentDto, @Request() req: AuthedRequest) {
    const actor = await this.buildActor(req);
    return this.issueService.processAttachment(dto, actor);
  }

  // ── 创建 / 相似 ─────────────────────────────────────────────────────────────

  @Post('find-similar')
  async findSimilar(@Body() dto: CreateIssueDto, @Request() req: AuthedRequest) {
    this.assertCreatePermission(req);
    const actor = await this.buildActor(req);
    return this.issueService.findSimilar(dto, actor);
  }

  @Post()
  async create(@Body() dto: CreateIssueDto, @Request() req: AuthedRequest) {
    this.assertCreatePermission(req);
    const actor = await this.buildActor(req);
    return this.issueService.create(dto, actor);
  }

  // ── 单条 ───────────────────────────────────────────────────────────────────

  @Get(':id')
  get(@Param('id') id: string) {
    return this.issueService.get(id);
  }

  // 长耗时 AI 操作（analyze/adjust/chat）改异步：立即返回 taskId，前端轮询 GET tasks/:taskId。
  @Post(':id/analyze')
  async analyze(
    @Param('id') id: string,
    @Body() body: { model?: string },
    @Request() req: AuthedRequest,
  ) {
    const actor = await this.buildActor(req);
    return { taskId: this.issueService.startAnalyze(id, actor, body?.model) };
  }

  @Post(':id/adjust')
  async adjust(@Param('id') id: string, @Body() dto: AdjustIssueDto, @Request() req: AuthedRequest) {
    const actor = await this.buildActor(req);
    return { taskId: this.issueService.startAdjust(id, dto.message, actor, dto.model) };
  }

  @Post(':id/chat')
  async sendChat(@Param('id') id: string, @Body() dto: SendChatDto, @Request() req: AuthedRequest) {
    const actor = await this.buildActor(req);
    return { taskId: this.issueService.startChat(id, dto, actor) };
  }

  @Post(':id/adopt')
  async adopt(@Param('id') id: string, @Body() dto: AdoptIssueDto, @Request() req: AuthedRequest) {
    const actor = await this.buildActor(req);
    return this.issueService.adopt(id, dto, actor);
  }

  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveIssueDto,
    @Request() req: AuthedRequest,
  ) {
    this.assertResolvePermission(req);
    const actor = await this.buildActor(req);
    return this.issueService.resolveIssue(id, dto.resolved, dto.note, actor);
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  private assertResolvePermission(req: AuthedRequest) {
    const perms = req.user.permissions ?? [];
    if (!perms.includes(SUPER_ADMIN_PERMISSION) && !perms.includes(RESOLVE_PERMISSION)) {
      throw new ForbiddenException('你没有「问题定性」权限');
    }
  }

  private assertCreatePermission(req: AuthedRequest) {
    const perms = req.user.permissions ?? [];
    if (!perms.includes(SUPER_ADMIN_PERMISSION) && !perms.includes(CREATE_PERMISSION)) {
      throw new ForbiddenException('你没有「登记问题」权限');
    }
  }

  private async buildActor(req: AuthedRequest): Promise<IssueActor> {
    const userId = req.user.id;
    let name = '操作人';
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      if (user?.name) name = user.name;
    } catch {
      // 查不到用户名不阻塞
    }
    return { userId, name, permissions: req.user.permissions ?? [] };
  }
}
