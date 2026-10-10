import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResearchDevelopmentService } from './research-development.service';
import { rdTaskReadViewer, type RdTaskAccessActor } from './rd-task-access';
import { currentRdWorkspace, isWorkspaceAllowed } from './rd-workspace.context';

const CATEGORY = 'rd-meeting-todos';
const PREFIX = 'rd.meeting-todos.';
const HISTORY_PAGE_SIZE = 24;
type ActorSnapshot = { id: string; name: string };
export type MeetingTodo = {
  id: string; memberId: string; memberName: string; title: string; description: string;
  dueDate: string | null; status: 'todo' | 'done';
  createdAt: string; createdBy: ActorSnapshot; updatedAt: string; updatedBy: ActorSnapshot;
  deletedAt?: string; deletedBy?: ActorSnapshot;
  carriedFrom?: { weekStart: string; itemId: string };
};
export type MeetingWeek = {
  weekStart: string; revision: number; createdAt: string; createdBy: ActorSnapshot;
  updatedAt: string; items: MeetingTodo[];
};

function bodyOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求内容格式不正确');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    throw new BadRequestException(`${label}${required ? '不能为空，且' : ''}最多 ${max} 字符`);
  }
  return value.trim();
}
function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('日期格式应为 YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException('日期无效');
  return value;
}
function weekDate(value: unknown): string {
  const date = dateOnly(value);
  if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) throw new BadRequestException('周清单必须以周一日期为起点');
  return date;
}
function revisionOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new BadRequestException('缺少有效版本，请刷新后重试');
  return value;
}
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class RdMeetingTodosService {
  constructor(private readonly prisma: PrismaService, private readonly rd: ResearchDevelopmentService) {}

  private authorize(actor: RdTaskAccessActor): ActorSnapshot {
    if (currentRdWorkspace() !== 'rd') throw new ForbiddenException('会议待办仅属于研发工作区');
    if (!actor.userId || !rdTaskReadViewer(actor).hasFullAccess || !isWorkspaceAllowed('rd', actor.permissions ?? [])) {
      throw new ForbiddenException('仅研发管理员可查看和维护会议待办');
    }
    return { id: actor.userId, name: actor.userName || '管理员' };
  }

  async members(actor: RdTaskAccessActor) {
    this.authorize(actor);
    const people = await this.rd.getPeople();
    return people.filter(person => person.status !== 'resigned' && person.user_status !== 'DISABLED')
      .map(person => ({ id: String(person.id), name: String(person.name), department: String(person.department ?? ''), position: String(person.position ?? '') }));
  }

  private decode(value: unknown, weekStart: string): MeetingWeek {
    const week = value as MeetingWeek;
    if (!week || week.weekStart !== weekStart || !Array.isArray(week.items) || !Number.isSafeInteger(week.revision)) {
      throw new InternalServerErrorException('周清单数据格式异常，请联系管理员');
    }
    return week;
  }

  async listWeeks(actor: RdTaskAccessActor, before?: string) {
    this.authorize(actor);
    const rows = await this.prisma.systemSetting.findMany({
      where: { category: CATEGORY, key: { startsWith: PREFIX, ...(before ? { lt: PREFIX + weekDate(before) } : {}) } },
      orderBy: { key: 'desc' }, take: HISTORY_PAGE_SIZE + 1, select: { key: true, value: true },
    });
    const weeks = rows.slice(0, HISTORY_PAGE_SIZE).map(row => {
      const week = this.decode(row.value, row.key.slice(PREFIX.length));
      const active = week.items.filter(item => !item.deletedAt);
      return { weekStart: week.weekStart, total: active.length, completed: active.filter(item => item.status === 'done').length, updatedAt: week.updatedAt };
    });
    return { weeks, nextBefore: rows.length > HISTORY_PAGE_SIZE ? weeks[weeks.length - 1].weekStart : null };
  }

  async getWeek(weekStart: string, actor: RdTaskAccessActor): Promise<MeetingWeek | null> {
    this.authorize(actor);
    const row = await this.prisma.systemSetting.findUnique({ where: { key: PREFIX + weekDate(weekStart) }, select: { value: true } });
    return row ? this.decode(row.value, weekStart) : null;
  }

  async createWeek(input: unknown, actor: RdTaskAccessActor): Promise<MeetingWeek> {
    const who = this.authorize(actor), body = bodyOf(input);
    const weekStart = weekDate(body.weekStart);
    const copyFrom = body.copyFromWeek ? weekDate(body.copyFromWeek) : null;
    if (copyFrom && copyFrom >= weekStart) throw new BadRequestException('只能复制目标周之前的清单');
    const now = new Date().toISOString();
    try {
      return await this.prisma.$transaction(async tx => {
        let source: MeetingWeek | null = null;
        if (copyFrom) {
          const row = await tx.systemSetting.findUnique({ where: { key: PREFIX + copyFrom } });
          if (!row) throw new NotFoundException('来源周清单不存在');
          source = this.decode(row.value, copyFrom);
        }
        const items: MeetingTodo[] = (source?.items ?? []).filter(item => !item.deletedAt && item.status === 'todo').map(item => ({
          id: randomUUID(), memberId: item.memberId, memberName: item.memberName, title: item.title,
          description: item.description, dueDate: item.dueDate, status: 'todo',
          createdAt: now, updatedAt: now, createdBy: who, updatedBy: who,
          carriedFrom: { weekStart: copyFrom!, itemId: item.id },
        }));
        const week: MeetingWeek = { weekStart, revision: 1, createdAt: now, updatedAt: now, createdBy: who, items };
        await tx.systemSetting.create({ data: { category: CATEGORY, key: PREFIX + weekStart, value: json(week), description: '研发每周会议分派记录' } });
        await this.audit(tx, who, 'meeting_week.created', weekStart, null, null,
          copyFrom ? `创建会议待办周清单，从 ${copyFrom} 复制 ${items.length} 个未完成事项` : '创建空白会议待办周清单', { copyFromWeek: copyFrom, items });
        return week;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('该周清单已存在，请刷新后查看');
      throw error;
    }
  }

  async addItem(weekStart: string, input: unknown, actor: RdTaskAccessActor) {
    const who = this.authorize(actor), body = bodyOf(input), revision = revisionOf(body.revision);
    const fields = await this.itemFields(body, actor);
    return this.mutate(weekStart, revision, async (week, tx) => {
      // ponytail: one JSON document per week, capped at 500 records; use a dedicated table beyond that scale.
      if (week.items.length >= 500) throw new BadRequestException('本周事项已达到 500 条上限（含已删除记录）');
      const now = new Date().toISOString();
      const item: MeetingTodo = { id: randomUUID(), ...fields, status: 'todo', createdAt: now, updatedAt: now, createdBy: who, updatedBy: who };
      week.items.push(item);
      await this.audit(tx, who, 'meeting_todo.created', weekStart, null, item, '新增会议待办');
    });
  }

  async updateItem(weekStart: string, id: string, input: unknown, actor: RdTaskAccessActor) {
    const who = this.authorize(actor), body = bodyOf(input), revision = revisionOf(body.revision);
    return this.mutate(weekStart, revision, async (week, tx) => {
      const index = week.items.findIndex(item => item.id === id && !item.deletedAt);
      if (index < 0) throw new NotFoundException('事项不存在或已删除');
      const before = week.items[index];
      const fields = await this.itemFields(body, actor, before);
      const status = body.status === undefined ? before.status : body.status;
      if (status !== 'todo' && status !== 'done') throw new BadRequestException('待办状态无效');
      const after = { ...before, ...fields, status, updatedAt: new Date().toISOString(), updatedBy: who } as MeetingTodo;
      week.items[index] = after;
      const action = before.status === after.status ? 'meeting_todo.updated' : status === 'done' ? 'meeting_todo.completed' : 'meeting_todo.reopened';
      await this.audit(tx, who, action, weekStart, before, after, status === before.status ? '修改会议待办' : status === 'done' ? '完成会议待办' : '重新打开会议待办');
    });
  }

  async deleteItem(weekStart: string, id: string, input: unknown, actor: RdTaskAccessActor) {
    const who = this.authorize(actor), body = bodyOf(input), revision = revisionOf(body.revision);
    return this.mutate(weekStart, revision, async (week, tx) => {
      const index = week.items.findIndex(item => item.id === id && !item.deletedAt);
      if (index < 0) throw new NotFoundException('事项不存在或已删除');
      const before = week.items[index], now = new Date().toISOString();
      const after = { ...before, deletedAt: now, deletedBy: who, updatedAt: now, updatedBy: who };
      week.items[index] = after;
      await this.audit(tx, who, 'meeting_todo.deleted', weekStart, before, after, '删除会议待办，保留历史记录');
    });
  }

  private async itemFields(body: Record<string, unknown>, actor: RdTaskAccessActor, before?: MeetingTodo) {
    const memberId = text(body.memberId ?? before?.memberId, '成员', 150, true);
    let memberName = before?.memberName ?? '';
    if (!before || memberId !== before.memberId) {
      const person = (await this.members(actor)).find(item => item.id === memberId);
      if (!person) throw new BadRequestException('请选择有效的研发成员');
      memberName = person.name;
    }
    const dueDate = body.dueDate === undefined ? before?.dueDate : body.dueDate;
    return { memberId, memberName, title: text(body.title ?? before?.title, '待办内容', 200, true),
      description: text(body.description === undefined ? before?.description : body.description, '备注', 2000),
      dueDate: dueDate == null || dueDate === '' ? null : dateOnly(dueDate) };
  }

  private async mutate(weekStart: string, revision: number, change: (week: MeetingWeek, tx: Prisma.TransactionClient) => Promise<void>) {
    const key = PREFIX + weekDate(weekStart);
    return this.prisma.$transaction(async tx => {
      const row = await tx.systemSetting.findUnique({ where: { key } });
      if (!row) throw new NotFoundException('请先创建该周清单');
      const week = this.decode(row.value, weekStart);
      if (week.revision !== revision) throw new ConflictException('清单已被其他操作更新，请刷新后重试');
      await change(week, tx);
      week.revision += 1;
      week.updatedAt = new Date().toISOString();
      const saved = await tx.systemSetting.updateMany({ where: { key, value: { path: ['revision'], equals: revision } }, data: { value: json(week) } });
      if (saved.count !== 1) throw new ConflictException('清单已被其他操作更新，请刷新后重试');
      return week;
    });
  }

  private async audit(tx: Prisma.TransactionClient, actor: ActorSnapshot, action: string, weekStart: string, before: MeetingTodo | null, after: MeetingTodo | null, summary: string, metadata = {}) {
    const item = after ?? before;
    const fields = { memberName: '成员', title: '待办内容', description: '备注', dueDate: '截止日期', status: '状态', deletedAt: '删除时间' } as const;
    const changes = Object.entries(fields).filter(([key]) => before?.[key] !== after?.[key])
      .map(([key, label]) => ({ field: label, before: before?.[key] ?? null, after: after?.[key] ?? null }));
    await tx.auditLog.create({ data: {
      userId: actor.id, actorName: actor.name, module: 'rd', source: 'web', action,
      resource: item ? 'meeting-todo' : 'meeting-week', resourceId: item?.id ?? weekStart,
      resourceName: item ? `${weekStart} · ${item.memberName} · ${item.title}` : `${weekStart} 周会议清单`,
      summary: `${summary} · ${weekStart}${item ? ` · ${item.memberName} · ${item.title}` : ''}`,
      meta: json({ changes, metadata: { weekStart, ...metadata }, before, after }), notes: [],
    } });
  }
}
