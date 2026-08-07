import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Request,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';

type AuthedRequest = { user?: { id?: string } };

import { Permissions } from '../auth/decorators/permissions.decorator';
import { currentRdWorkspace, RdWorkspaceInterceptor } from './rd-workspace.context';
import {
  RdAiService,
  type RdAiProjectClassificationInput,
  type RdAiProjectClassificationResult,
  type RdAiPersonContext,
  type RdAiProductOption,
  type RdAiProposalRefineScope,
  type RdAiProposalTaskInput,
} from './rd-ai.service';
import { ResearchDevelopmentService } from './research-development.service';

type RdProjectClassificationRequestBody = {
  product_id?: string;
  category_id?: string;
  sub_project_id?: string;
  instruction?: string;
};

type RdProjectClassificationJob = {
  userId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: RdAiProjectClassificationResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      return raw.split(/[,，;；、]/).map((x) => x.trim()).filter(Boolean);
    }
  }
  return [];
}

function parsePeopleProfiles(raw: unknown): RdAiPersonContext[] {
  const value = typeof raw === 'string' && raw.trim() ? safeJsonParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .map((item): RdAiPersonContext | null => {
      if (!item || typeof item !== 'object') return null;
      const person = item as Record<string, unknown>;
      const name = typeof person.name === 'string' ? person.name.trim() : '';
      if (!name) return null;
      return {
        id: typeof person.id === 'string' ? person.id : undefined,
        name,
        position: typeof person.position === 'string' ? person.position : undefined,
        department: typeof person.department === 'string' ? person.department : undefined,
        task_count: toOptionalNumber(person.task_count),
        max_tasks: toOptionalNumber(person.max_tasks),
        on_leave: Boolean(person.on_leave),
        blocked_count: toOptionalNumber(person.blocked_count),
        avg_completion: toOptionalNumber(person.avg_completion),
        completed_this_month: toOptionalNumber(person.completed_this_month),
        tasks: Array.isArray(person.tasks) ? person.tasks.map((task) => String(task).trim()).filter(Boolean) : undefined,
      };
    })
    .filter((item): item is RdAiPersonContext => item !== null);
}

function parseTaskDrafts(raw: unknown): RdAiProposalTaskInput[] {
  const value = typeof raw === 'string' && raw.trim() ? safeJsonParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .map((item): RdAiProposalTaskInput | null => {
      if (!item || typeof item !== 'object') return null;
      const task = item as Record<string, unknown>;
      const title = typeof task.title === 'string' ? task.title.trim() : '';
      if (!title) return null;
      return {
        id: typeof task.id === 'string' ? task.id : undefined,
        title,
        description: typeof task.description === 'string' ? task.description : undefined,
        owner: typeof task.owner === 'string' ? task.owner : '待指派',
        owner_reason: typeof task.owner_reason === 'string' ? task.owner_reason : '',
        due_date: typeof task.due_date === 'string' ? task.due_date : '',
        priority: task.priority === 'high' || task.priority === 'low' ? task.priority : 'medium',
        category_path: typeof task.category_path === 'string' ? task.category_path : '',
        estimated_days: toOptionalNumber(task.estimated_days) ?? 5,
        ai_estimated_days: toOptionalNumber(task.ai_estimated_days),
        duration_basis: typeof task.duration_basis === 'string' ? task.duration_basis : undefined,
      };
    })
    .filter((item): item is RdAiProposalTaskInput => item !== null);
}

function parseProductOptions(raw: unknown): RdAiProductOption[] {
  const value = typeof raw === 'string' && raw.trim() ? safeJsonParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .map((item): RdAiProductOption | null => {
      if (!item || typeof item !== 'object') return null;
      const product = item as Record<string, unknown>;
      const id = typeof product.id === 'string' ? product.id.trim() : '';
      const name = typeof product.name === 'string' ? product.name.trim() : '';
      if (!id || !name) return null;
      return { id, name };
    })
    .filter((item): item is RdAiProductOption => item !== null);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

@Controller('research-development/ai')
@Permissions('rd-project:propose', 'rd-project:direct', 'page:rd-director-dashboard')
// 工作区隔离：与主控制器一致，?workspace=us-collab 时 AI 场景/工件读写协同池
@UseInterceptors(RdWorkspaceInterceptor)
export class RdAiController {
  private readonly projectClassificationJobs = new Map<string, RdProjectClassificationJob>();

  constructor(
    private readonly rdAiService: RdAiService,
    private readonly researchDevelopmentService: ResearchDevelopmentService,
  ) {}

  @Post('extract-tasks')
  async extractFromText(
    @Body()
    body: {
      text?: string;
      peopleNames?: string[];
      peopleProfiles?: RdAiPersonContext[];
      categoryLabels?: string[];
      proposalTitle?: string;
      products?: RdAiProductOption[];
    },
  ) {
    return this.rdAiService.extract({
      text: body.text ?? '',
      peopleNames: parseList(body.peopleNames),
      peopleProfiles: parsePeopleProfiles(body.peopleProfiles),
      categoryLabels: parseList(body.categoryLabels),
      proposalTitle: body.proposalTitle,
      products: parseProductOptions(body.products),
    });
  }

  @Post('extract-from-file')
  @UseInterceptors(FileInterceptor('file'))
  async extractFromFile(
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype?: string } | undefined,
    @Body()
    body: {
      peopleNames?: string | string[];
      peopleProfiles?: string | RdAiPersonContext[];
      categoryLabels?: string | string[];
      proposalTitle?: string;
      products?: string | RdAiProductOption[];
    },
  ) {
    return this.rdAiService.extract({
      file,
      peopleNames: parseList(body.peopleNames),
      peopleProfiles: parsePeopleProfiles(body.peopleProfiles),
      categoryLabels: parseList(body.categoryLabels),
      proposalTitle: body.proposalTitle,
      products: parseProductOptions(body.products),
    });
  }

  @Post('refine-proposal')
  async refineProposal(
    @Body()
    body: {
      proposalTitle?: string;
      originalInput?: string;
      currentTasks?: unknown;
      instruction?: string;
      peopleNames?: string[];
      peopleProfiles?: RdAiPersonContext[];
      categoryLabels?: string[];
      scope?: RdAiProposalRefineScope;
      selectedTaskIds?: string[];
    },
  ) {
    const scope =
      body.scope === 'all' || body.scope === 'selected' || body.scope === 'single'
        ? body.scope
        : undefined;

    return this.rdAiService.refineProposal({
      proposalTitle: body.proposalTitle,
      originalInput: body.originalInput,
      currentTasks: parseTaskDrafts(body.currentTasks),
      instruction: String(body.instruction ?? ''),
      peopleNames: parseList(body.peopleNames),
      peopleProfiles: parsePeopleProfiles(body.peopleProfiles),
      categoryLabels: parseList(body.categoryLabels),
      scope,
      selectedTaskIds: parseList(body.selectedTaskIds),
    });
  }

  @Post('classify-project')
  @Permissions('rd-project:direct')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: 25 * 1024 * 1024 } }))
  async classifyProject(
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }> | undefined,
    @Body() body: RdProjectClassificationRequestBody,
  ) {
    return this.rdAiService.classifyProject(await this.buildProjectClassificationInput(files, body));
  }

  /**
   * 全量归纳可能包含多轮 AI 调用，耗时会超过线上反向代理的 120 秒空闲超时。
   * 提交接口只创建后台任务，前端通过短轮询取结果，避免长连接被网关提前断开。
   */
  @Post('classify-project-jobs')
  @Permissions('rd-project:direct')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: 25 * 1024 * 1024 } }))
  async createProjectClassificationJob(
    @Request() request: AuthedRequest,
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }> | undefined,
    @Body() body: RdProjectClassificationRequestBody,
  ) {
    const userId = request.user?.id?.trim();
    if (!userId) throw new ForbiddenException('无法确认当前操作人');

    const input = await this.buildProjectClassificationInput(files, body);
    const jobId = randomUUID();
    const now = new Date().toISOString();
    this.projectClassificationJobs.set(jobId, {
      userId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    });

    setImmediate(() => {
      const queued = this.projectClassificationJobs.get(jobId);
      if (!queued) return;
      queued.status = 'running';
      queued.updatedAt = new Date().toISOString();
      void this.rdAiService.classifyProject(input)
        .then((result) => {
          const current = this.projectClassificationJobs.get(jobId);
          if (!current) return;
          current.status = 'completed';
          current.result = result;
          current.updatedAt = new Date().toISOString();
        })
        .catch((error: unknown) => {
          const current = this.projectClassificationJobs.get(jobId);
          if (!current) return;
          current.status = 'failed';
          current.error = error instanceof Error ? error.message : 'AI 全量任务归纳失败';
          current.updatedAt = new Date().toISOString();
        })
        .finally(() => {
          const cleanup = setTimeout(() => this.projectClassificationJobs.delete(jobId), 30 * 60 * 1000);
          cleanup.unref?.();
        });
    });

    return { job_id: jobId, status: 'queued' as const, created_at: now };
  }

  @Get('classify-project-jobs/:jobId')
  @Permissions('rd-project:direct')
  getProjectClassificationJob(
    @Request() request: AuthedRequest,
    @Param('jobId') jobId: string,
  ) {
    const job = this.projectClassificationJobs.get(jobId);
    if (!job || !request.user?.id || job.userId !== request.user.id) {
      throw new NotFoundException('分析任务不存在或已过期，请重新生成');
    }
    return {
      job_id: jobId,
      status: job.status,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    };
  }

  private async buildProjectClassificationInput(
    files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }> | undefined,
    body: RdProjectClassificationRequestBody,
  ): Promise<RdAiProjectClassificationInput> {
    if (currentRdWorkspace() !== 'rd') {
      throw new ForbiddenException('AI 全量任务归纳仅在研发任务驾驶舱中可用');
    }
    const totalFileBytes = (files ?? []).reduce((sum, file) => sum + file.buffer.length, 0);
    if (totalFileBytes > 50 * 1024 * 1024) {
      throw new BadRequestException('附件总大小不能超过 50 MB');
    }
    const context = await this.researchDevelopmentService.getProjectClassificationContext({
      productId: body.product_id,
      categoryId: body.category_id,
      subProjectId: body.sub_project_id,
    });
    return {
      scope: {
        product_id: context.product_id,
        category_id: context.category_id,
        ...(context.sub_project_id ? { sub_project_id: context.sub_project_id } : {}),
        label: context.label,
        task_count: context.task_count,
      },
      tasks: context.tasks,
      instruction: body.instruction,
      files: files ?? [],
    };
  }

  @Post('assess-progress')
  @Permissions('page:rd-my-workspace', 'page:us-collab-workspace', 'rd-task:edit', 'rd-task:create', 'page:rd-director-dashboard')
  @UseInterceptors(FilesInterceptor('files', 10))
  async assessProgress(
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }> | undefined,
    @Body()
    body: {
      text?: string;
      task_id?: string;
      title?: string;
      description?: string;
      category_path?: string;
      current_progress?: string | number;
      current_status?: string;
      /** 工作项清单 JSON 字符串（FormData 传输），AI 判断本次进展归属哪个工作项 */
      work_items?: string;
    },
    @Request() req: AuthedRequest,
  ) {
    const title = (body.title ?? '').toString().trim();
    if (!title) {
      throw new BadRequestException('title 不能为空');
    }
    const currentProgressRaw = body.current_progress;
    const currentProgress =
      typeof currentProgressRaw === 'number'
        ? currentProgressRaw
        : Number(currentProgressRaw) || 0;

    // 工作项清单：解析失败/非数组一律忽略（归属判断是可选增强，不影响进度判断主流程）
    let workItems: Array<{ id: string; title: string; done?: boolean }> | undefined;
    if (typeof body.work_items === 'string' && body.work_items.trim()) {
      try {
        const parsed = JSON.parse(body.work_items);
        if (Array.isArray(parsed)) {
          workItems = parsed
            .filter((it) => it && typeof it === 'object')
            .map((it) => ({
              id: String((it as { id?: unknown }).id ?? ''),
              title: String((it as { title?: unknown }).title ?? ''),
              done: (it as { done?: unknown }).done === true,
            }))
            .filter((it) => it.id && it.title)
            .slice(0, 50);
        }
      } catch {
        // ignore malformed work_items
      }
    }

    return this.rdAiService.assessProgress({
      files: files ?? [],
      text: body.text,
      requesterUserId: req.user?.id,
      task: {
        task_id: (body.task_id ?? '').toString(),
        title,
        description: body.description?.toString(),
        category_path: body.category_path?.toString(),
        current_progress: currentProgress,
        current_status: body.current_status?.toString(),
        work_items: workItems,
      },
    });
  }
}
