import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { RdAiService, type RdAiPersonContext } from './rd-ai.service';

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
export class RdAiController {
  constructor(private readonly rdAiService: RdAiService) {}

  @Post('extract-tasks')
  async extractFromText(
    @Body()
    body: {
      text?: string;
      peopleNames?: string[];
      peopleProfiles?: RdAiPersonContext[];
      categoryLabels?: string[];
      proposalTitle?: string;
    },
  ) {
    return this.rdAiService.extract({
      text: body.text ?? '',
      peopleNames: parseList(body.peopleNames),
      peopleProfiles: parsePeopleProfiles(body.peopleProfiles),
      categoryLabels: parseList(body.categoryLabels),
      proposalTitle: body.proposalTitle,
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
    },
  ) {
    return this.rdAiService.extract({
      file,
      peopleNames: parseList(body.peopleNames),
      peopleProfiles: parsePeopleProfiles(body.peopleProfiles),
      categoryLabels: parseList(body.categoryLabels),
      proposalTitle: body.proposalTitle,
    });
  }

  @Post('assess-progress')
  @Permissions('page:rd-my-workspace', 'rd-task:edit', 'rd-task:create', 'page:rd-director-dashboard')
  @UseInterceptors(FileInterceptor('file'))
  async assessProgress(
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype?: string } | undefined,
    @Body()
    body: {
      text?: string;
      task_id?: string;
      title?: string;
      description?: string;
      category_path?: string;
      current_progress?: string | number;
      current_status?: string;
    },
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

    return this.rdAiService.assessProgress({
      file,
      text: body.text,
      task: {
        task_id: (body.task_id ?? '').toString(),
        title,
        description: body.description?.toString(),
        category_path: body.category_path?.toString(),
        current_progress: currentProgress,
        current_status: body.current_status?.toString(),
      },
    });
  }
}
